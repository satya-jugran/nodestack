import { ConflictError, ServiceUnavailableError } from '../errors/AppError';

export interface MaintenanceGateOptions {
  /** Maximum time (ms) to wait for in-flight requests to drain before starting exclusive work. Default: 5000ms */
  drainTimeoutMs?: number;
  /** Maximum time (ms) a request can wait in queue before timing out with 503. Default: 10000ms */
  requestQueueTimeoutMs?: number;
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

  constructor(private options: MaintenanceGateOptions = {}) {}

  /**
   * Returns whether maintenance mode / gate is currently active.
   */
  public isMaintenanceActive(): boolean {
    return this.isGated;
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

    if (this.isGated) {
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
   */
  public trackRequestEnd(requestId: string): void {
    if (this.activeRequests.delete(requestId)) {
      if (this.isGated && this.activeRequests.size === 0) {
        this.notifyDrain();
      }
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

    this.isExecutingExclusive = true;
    this.isGated = true;

    try {
      // 1. Wait for existing in-flight requests to complete
      await this.drainInFlightRequests();

      // 2. Perform exclusive action safely (zero active requests)
      return await action();
    } finally {
      // 3. Guaranteed unlock and queue flush
      this.isGated = false;
      this.isExecutingExclusive = false;
      this.flushWaitingQueue();
    }
  }

  private async drainInFlightRequests(): Promise<void> {
    if (this.activeRequests.size === 0) {
      return;
    }

    const drainTimeoutMs = this.options.drainTimeoutMs ?? 5000;

    await new Promise<void>((resolve) => {
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
        resolve(); // Continue even if drain timed out to avoid permanent lock
      }, drainTimeoutMs);

      this.drainResolvers.push(onDrain);
    });
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
}
