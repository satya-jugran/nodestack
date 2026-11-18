import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConflictError, ServiceUnavailableError } from '../errors/AppError';

export interface MaintenanceGateOptions {
  /** Maximum time (ms) to wait for in-flight requests to drain before aborting exclusive work with 503. Default: 5000ms */
  drainTimeoutMs?: number;
  /** Maximum time (ms) a request can wait in queue before timing out with 503. Default: 10000ms */
  requestQueueTimeoutMs?: number;
  /** Optional file lock path for multi-process / restart-safe cross-instance coordination */
  lockFilePath?: string;
}

/**
 * Coordinates exclusive system operations (such as "Reset to Demo State")
 * with incoming and in-flight HTTP requests and database operations.
 *
 * Responsibilities:
 * 1. Gates incoming requests during reset, holding them in an asynchronous queue.
 * 2. Drains all active in-flight requests before database closing or filesystem swaps occur.
 * 3. Prevents race conditions and in-flight handlers observing partially swapped files or closed drivers.
 * 4. Safely flushes queued requests once the clean state has been fully restored and reconnected.
 */
export class MaintenanceGate {
  private isGated = false;
  private isExecutingExclusive = false;
  private activeRequests = new Set<string>();
  private waitingQueue: Array<{
    requestId: string;
    resolve: () => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private drainResolvers: Array<() => void> = [];
  private lockFilePath?: string;
  private currentLockToken?: string;

  constructor(private options: MaintenanceGateOptions = {}) {
    this.lockFilePath = options.lockFilePath;
    this.reclaimLockIfDeadOwner();
  }

  public setLockFilePath(filePath: string): void {
    this.lockFilePath = filePath;
    this.reclaimLockIfDeadOwner();
  }

  /**
   * Checks whether a process with the given PID is currently alive on the system.
   */
  public isProcessAlive(pid: number): boolean {
    if (!pid || typeof pid !== 'number' || pid <= 0) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      if (err && err.code === 'EPERM') {
        return true;
      }
      return false;
    }
  }

  /**
   * Inspects the lockfile and reclaims it only if the owner process is dead or if unparseable.
   * If the owner process is still alive (or currently executing exclusive in this process),
   * the lock is preserved regardless of how long it has been held.
   *
   * @returns true if no lock exists or a dead lock was reclaimed; false if held by an active live owner.
   */
  public reclaimLockIfDeadOwner(): boolean {
    if (!this.lockFilePath) return true;
    try {
      if (!fs.existsSync(this.lockFilePath)) {
        return true;
      }
      const content = fs.readFileSync(this.lockFilePath, 'utf8');
      let meta: any;
      try {
        meta = JSON.parse(content);
      } catch {
        try {
          fs.unlinkSync(this.lockFilePath);
          return true;
        } catch {
          return false;
        }
      }

      const pid = meta?.pid;
      if (!pid || typeof pid !== 'number' || pid <= 0) {
        try {
          fs.unlinkSync(this.lockFilePath);
          return true;
        } catch {
          return false;
        }
      }

      // If owned by current process, the owner is alive:
      if (pid === process.pid) {
        return false;
      }

      // If owned by another process, only reclaim if the owner is dead
      if (!this.isProcessAlive(pid)) {
        try {
          fs.unlinkSync(this.lockFilePath);
          return true;
        } catch {
          return false;
        }
      }

      // Owner process is alive: lock is actively held
      return false;
    } catch {
      return !fs.existsSync(this.lockFilePath);
    }
  }

  public checkStaleLock(): void {
    this.reclaimLockIfDeadOwner();
  }

  /**
   * Returns whether maintenance mode / gate is currently active.
   */
  public isMaintenanceActive(): boolean {
    if (this.isGated) return true;
    if (this.lockFilePath) {
      try {
        if (fs.existsSync(this.lockFilePath)) {
          const isFree = this.reclaimLockIfDeadOwner();
          return !isFree;
        }
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Returns whether an exclusive operation is currently executing.
   */
  public isExclusiveActive(): boolean {
    return this.isExecutingExclusive;
  }

  /**
   * Returns the count of active non-exempt in-flight requests.
   */
  public getActiveRequestsCount(): number {
    return this.activeRequests.size;
  }

  /**
   * Returns the count of requests currently waiting in queue.
   */
  public getWaitingQueueLength(): number {
    return this.waitingQueue.length;
  }

  /**
   * Tracks incoming request start.
   * If maintenance mode is active, the request is held in queue until maintenance completes.
   * If isExempt is true (e.g., the reset endpoint or SSE stream), it proceeds immediately.
   */
  public async trackRequestStart(requestId: string, isExempt = false): Promise<void> {
    if (isExempt) {
      return;
    }

    if (this.isMaintenanceActive()) {
      // Hold incoming request in queue until exclusive maintenance completes
      await new Promise<void>((resolve, reject) => {
        const timeoutMs = this.options.requestQueueTimeoutMs ?? 10000;
        const timer = setTimeout(() => {
          const idx = this.waitingQueue.findIndex((item) => item.requestId === requestId);
          if (idx !== -1) {
            this.waitingQueue.splice(idx, 1);
          }
          reject(
            new ServiceUnavailableError(
              'Server is temporarily undergoing demo reset maintenance. Request timed out in queue.'
            )
          );
        }, timeoutMs);

        this.waitingQueue.push({
          requestId,
          resolve,
          reject,
          timer,
        });
      });
    }

    this.activeRequests.add(requestId);
  }

  /**
   * Tracks request completion. Removes requestId from active requests
   * and notifies drain listeners when all in-flight requests have finished.
   * Notifies independently of isGated so standalone/shutdown drain callers
   * receive immediate completion notifications.
   */
  public trackRequestEnd(requestId: string): void {
    if (this.activeRequests.delete(requestId)) {
      if (this.activeRequests.size === 0) {
        this.notifyDrain();
      }
    }
  }

  /**
   * Explicitly activates the gate to hold incoming requests in queue.
   */
  public gate(): void {
    this.isGated = true;
  }

  /**
   * Deactivates the gate and releases all queued requests in FIFO order.
   */
  public ungate(): void {
    this.isGated = false;
    this.flushWaitingQueue();
  }

  /**
   * Returns the current instance-specific lock token if this instance holds the lock.
   */
  public getCurrentLockToken(): string | undefined {
    return this.currentLockToken;
  }

  /**
   * Atomically acquires the file lock using exclusive open ('wx').
   * Stores an instance-specific owner token in the lock file.
   * If the file already exists (EEXIST), checks if the holding process is dead.
   * If dead, reclaims the lock and retries once.
   * If alive (or retry also fails with EEXIST), throws ConflictError.
   */
  public acquireFileLock(): void {
    if (!this.lockFilePath) return;

    const dir = path.dirname(this.lockFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Attempt to reclaim if an existing lock belongs to a dead owner first
    this.reclaimLockIfDeadOwner();

    const token = crypto.randomUUID();
    const payload = JSON.stringify({
      pid: process.pid,
      token,
      timestamp: new Date().toISOString(),
    });

    try {
      this.writeLockAtomic(payload);
      this.currentLockToken = token;
    } catch (err: any) {
      if (err && err.code === 'EEXIST') {
        // Atomic collision: another process created the lock first.
        const isFree = this.reclaimLockIfDeadOwner();
        if (isFree) {
          try {
            this.writeLockAtomic(payload);
            this.currentLockToken = token;
            return;
          } catch (retryErr: any) {
            if (retryErr && retryErr.code === 'EEXIST') {
              throw new ConflictError('A demo reset or maintenance operation is already in progress.');
            }
            throw retryErr;
          }
        }
        throw new ConflictError('A demo reset or maintenance operation is already in progress.');
      }
      throw err;
    }
  }

  private writeLockAtomic(payload: string): void {
    if (!this.lockFilePath) return;
    const fd = fs.openSync(this.lockFilePath, 'wx');
    try {
      fs.writeFileSync(fd, payload, 'utf8');
    } finally {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }

  /**
   * Releases the file lock ONLY if this specific MaintenanceGate instance created it.
   * Verifies the instance owner token matches the token stored in the file on disk.
   */
  public releaseFileLock(): void {
    if (!this.lockFilePath || !this.currentLockToken) return;

    const tokenToRelease = this.currentLockToken;
    this.currentLockToken = undefined;

    try {
      if (fs.existsSync(this.lockFilePath)) {
        const content = fs.readFileSync(this.lockFilePath, 'utf8');
        let meta: any;
        try {
          meta = JSON.parse(content);
        } catch {}
        if (meta && meta.token === tokenToRelease) {
          fs.unlinkSync(this.lockFilePath);
        }
      }
    } catch {
      // non-fatal
    }
  }

  /**
   * Coordinates exclusive execution (e.g., demo reset):
   * 1. Gates the server (holds new incoming requests in queue).
   * 2. Waits for all current in-flight requests to drain to 0.
   * 3. Executes the exclusive action (file swap, database reconnect).
   * 4. Unlocks the gate and releases all queued requests in FIFO order.
   */
  public async executeExclusive<T>(action: () => Promise<T> | T): Promise<T> {
    if (this.isExecutingExclusive) {
      throw new ConflictError('A demo reset or maintenance operation is already in progress.');
    }

    let acquiredFileLock = false;
    if (this.lockFilePath) {
      this.acquireFileLock();
      acquiredFileLock = true;
    }

    this.isExecutingExclusive = true;
    this.isGated = true;

    try {
      // 1. Wait for existing in-flight requests to complete
      await this.drainInFlightRequests();

      // 2. Perform exclusive action safely (zero active requests)
      return await action();
    } finally {
      // 3. Guaranteed unlock, lockfile release, and queue flush
      this.isGated = false;
      this.isExecutingExclusive = false;
      if (acquiredFileLock && this.lockFilePath) {
        this.releaseFileLock();
      }
      this.flushWaitingQueue();
    }
  }

  public async drain(timeoutMs?: number): Promise<void> {
    if (this.activeRequests.size === 0) {
      return;
    }

    const drainTimeoutMs = timeoutMs ?? this.options.drainTimeoutMs ?? 5000;

    await new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;

      const onDrain = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };

      timer = setTimeout(() => {
        const idx = this.drainResolvers.indexOf(onDrain);
        if (idx !== -1) {
          this.drainResolvers.splice(idx, 1);
        }
        reject(
          new ServiceUnavailableError(
            `Timed out after ${drainTimeoutMs}ms waiting for ${this.activeRequests.size} in-flight request(s) to drain.`
          )
        );
      }, drainTimeoutMs);

      this.drainResolvers.push(onDrain);
    });
  }

  private async drainInFlightRequests(): Promise<void> {
    return this.drain();
  }

  private notifyDrain(): void {
    const resolvers = [...this.drainResolvers];
    this.drainResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }

  private flushWaitingQueue(): void {
    const queue = [...this.waitingQueue];
    this.waitingQueue = [];
    for (const item of queue) {
      clearTimeout(item.timer);
      item.resolve();
    }
  }

  public reset(): void {
    this.isGated = false;
    this.isExecutingExclusive = false;
    this.releaseFileLock();
    this.activeRequests.clear();
    this.flushWaitingQueue();
    this.notifyDrain();
  }
}
