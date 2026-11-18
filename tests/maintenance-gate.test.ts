import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MaintenanceGate } from '../src/core/maintenance/MaintenanceGate';
import { ConflictError, ServiceUnavailableError } from '../src/core/errors/AppError';

describe('MaintenanceGate', () => {
  it('should reject and abort exclusive action when in-flight requests fail to drain before drainTimeoutMs', async () => {
    const gate = new MaintenanceGate({ drainTimeoutMs: 50, requestQueueTimeoutMs: 500 });

    await gate.trackRequestStart('inflight-1');
    expect(gate.getActiveRequestsCount()).toBe(1);

    const action = vi.fn(async () => 'should-not-run');

    await expect(gate.executeExclusive(action)).rejects.toThrow(ServiceUnavailableError);
    expect(action).not.toHaveBeenCalled();

    // Gate must be unlocked even after drain timeout
    expect(gate.isMaintenanceActive()).toBe(false);
    expect(gate.isExclusiveActive()).toBe(false);

    // Clean up in-flight request and verify subsequent exclusive operations succeed
    gate.trackRequestEnd('inflight-1');
    expect(gate.getActiveRequestsCount()).toBe(0);

    const actionAfterDrain = vi.fn(async () => 'ok');
    await expect(gate.executeExclusive(actionAfterDrain)).resolves.toBe('ok');
    expect(actionAfterDrain).toHaveBeenCalledTimes(1);
  });

  it('should flush queued requests after drain timeout without leaving them stuck', async () => {
    const gate = new MaintenanceGate({ drainTimeoutMs: 50, requestQueueTimeoutMs: 500 });

    await gate.trackRequestStart('inflight-1');

    const action = vi.fn(async () => 'aborted');
    const exclusivePromise = gate.executeExclusive(action);

    // Incoming request arrives while gated and waiting to drain
    let queuedResolved = false;
    const queuedPromise = gate.trackRequestStart('queued-1').then(() => {
      queuedResolved = true;
    });

    expect(gate.getWaitingQueueLength()).toBe(1);
    expect(queuedResolved).toBe(false);

    await expect(exclusivePromise).rejects.toThrow(
      /Timed out after 50ms waiting for 1 in-flight request\(s\) to drain/
    );
    expect(action).not.toHaveBeenCalled();

    await queuedPromise;
    expect(queuedResolved).toBe(true);
    expect(gate.getWaitingQueueLength()).toBe(0);

    gate.trackRequestEnd('inflight-1');
    gate.trackRequestEnd('queued-1');
  });

  it('should execute exclusive action once in-flight requests drain within drainTimeoutMs', async () => {
    const gate = new MaintenanceGate({ drainTimeoutMs: 300 });

    await gate.trackRequestStart('inflight-1');

    let actionRan = false;
    const exclusivePromise = gate.executeExclusive(async () => {
      expect(gate.getActiveRequestsCount()).toBe(0);
      actionRan = true;
      return 'restored';
    });

    setTimeout(() => {
      gate.trackRequestEnd('inflight-1');
    }, 30);

    await expect(exclusivePromise).resolves.toBe('restored');
    expect(actionRan).toBe(true);
    expect(gate.isMaintenanceActive()).toBe(false);
    expect(gate.isExclusiveActive()).toBe(false);
  });

  it('should reject concurrent executeExclusive calls with ConflictError', async () => {
    const gate = new MaintenanceGate({ drainTimeoutMs: 200 });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = gate.executeExclusive(async () => {
      await hold;
      return 'first';
    });

    await expect(gate.executeExclusive(async () => 'second')).rejects.toThrow(ConflictError);

    release();
    await expect(first).resolves.toBe('first');
  });

  it('should notify drain listeners immediately when requests finish while isGated is false', async () => {
    const gate = new MaintenanceGate({ drainTimeoutMs: 2000 });
    expect(gate.isMaintenanceActive()).toBe(false);

    await gate.trackRequestStart('standalone-req');
    expect(gate.getActiveRequestsCount()).toBe(1);

    const startTime = Date.now();
    const drainPromise = gate.drain(2000);

    setTimeout(() => {
      gate.trackRequestEnd('standalone-req');
    }, 25);

    await expect(drainPromise).resolves.toBeUndefined();
    const elapsed = Date.now() - startTime;
    // Should resolve immediately upon request completion rather than waiting for 2000ms timeout
    expect(elapsed).toBeLessThan(500);
    expect(gate.getActiveRequestsCount()).toBe(0);
  });

  it('should support explicit gate() and ungate() methods', async () => {
    const gate = new MaintenanceGate();
    expect(gate.isMaintenanceActive()).toBe(false);

    gate.gate();
    expect(gate.isMaintenanceActive()).toBe(true);

    gate.ungate();
    expect(gate.isMaintenanceActive()).toBe(false);
  });

  it('should reject drain with ServiceUnavailableError when requests fail to finish before timeout', async () => {
    const gate = new MaintenanceGate();
    await gate.trackRequestStart('lingering-req');
    expect(gate.getActiveRequestsCount()).toBe(1);

    await expect(gate.drain(60)).rejects.toThrow(
      /Timed out after 60ms waiting for 1 in-flight request\(s\) to drain/
    );

    gate.trackRequestEnd('lingering-req');
    expect(gate.getActiveRequestsCount()).toBe(0);
  });

  describe('Ownership & Liveness File Lock Coordination', () => {
    const lockDir = path.resolve(__dirname, '../.test_maintenance_lock');
    const lockFilePath = path.join(lockDir, 'maintenance.lock');

    afterEach(() => {
      if (fs.existsSync(lockDir)) {
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
    });

    it('should correctly report liveness using isProcessAlive', () => {
      const gate = new MaintenanceGate();
      // Current process PID is alive
      expect(gate.isProcessAlive(process.pid)).toBe(true);
      // Non-positive or invalid PIDs are not alive
      expect(gate.isProcessAlive(0)).toBe(false);
      expect(gate.isProcessAlive(-1)).toBe(false);
      // Non-existent PID
      expect(gate.isProcessAlive(9999999)).toBe(false);
    });

    it('should PRESERVE lock held by a live process even if older than 60 seconds (prevents premature reclamation)', () => {
      fs.mkdirSync(lockDir, { recursive: true });
      // Simulate lock held by another live process created 5 minutes ago
      const fiveMinutesAgo = new Date(Date.now() - 300000).toISOString();
      fs.writeFileSync(
        lockFilePath,
        JSON.stringify({ pid: 1, timestamp: fiveMinutesAgo }) // PID 1 or another live process
      );

      const gate = new MaintenanceGate();
      // Stub isProcessAlive to return true for this owner
      vi.spyOn(gate, 'isProcessAlive').mockImplementation((pid) => pid === 1);
      gate.setLockFilePath(lockFilePath);

      // Lock must NOT be reclaimed because owner is alive!
      expect(gate.isMaintenanceActive()).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Reclaim attempt must preserve it and report active lock held
      const isFree = gate.reclaimLockIfDeadOwner();
      expect(isFree).toBe(false);
      expect(fs.existsSync(lockFilePath)).toBe(true);
    });

    it('should RECLAIM lock when owner process is dead', () => {
      fs.mkdirSync(lockDir, { recursive: true });
      const deadPid = 9999999;
      fs.writeFileSync(
        lockFilePath,
        JSON.stringify({ pid: deadPid, timestamp: new Date().toISOString() })
      );

      const gate = new MaintenanceGate();
      vi.spyOn(gate, 'isProcessAlive').mockReturnValue(false);
      gate.setLockFilePath(lockFilePath);

      // Dead owner -> lock must be reclaimed
      expect(gate.isMaintenanceActive()).toBe(false);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it('should RECLAIM corrupt or invalid lock file without throwing', () => {
      fs.mkdirSync(lockDir, { recursive: true });
      fs.writeFileSync(lockFilePath, 'not-valid-json{{{');

      const gate = new MaintenanceGate({ lockFilePath });
      expect(gate.isMaintenanceActive()).toBe(false);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it('should create and release lock file atomically during executeExclusive', async () => {
      const gate = new MaintenanceGate({ lockFilePath });

      let lockExistedDuringAction = false;
      let recordedPid: number | undefined;

      await gate.executeExclusive(async () => {
        lockExistedDuringAction = fs.existsSync(lockFilePath);
        if (lockExistedDuringAction) {
          const content = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
          recordedPid = content.pid;
        }
      });

      expect(lockExistedDuringAction).toBe(true);
      expect(recordedPid).toBe(process.pid);
      // Cleaned up after completion
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it('should reject executeExclusive if another live process holds the lock', async () => {
      fs.mkdirSync(lockDir, { recursive: true });
      fs.writeFileSync(
        lockFilePath,
        JSON.stringify({ pid: 88888, timestamp: new Date().toISOString() })
      );

      const gate = new MaintenanceGate();
      vi.spyOn(gate, 'isProcessAlive').mockImplementation((pid) => pid === 88888);
      gate.setLockFilePath(lockFilePath);

      await expect(gate.executeExclusive(async () => 'conflict')).rejects.toThrow(ConflictError);
      expect(fs.existsSync(lockFilePath)).toBe(true);
    });

    it('should acquire lock atomically using wx exclusive open and reject concurrent acquire', () => {
      const gate1 = new MaintenanceGate({ lockFilePath });
      const gate2 = new MaintenanceGate({ lockFilePath });

      gate1.acquireFileLock();
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Second gate attempts atomic acquisition on existing lock held by current process -> throws ConflictError
      expect(() => gate2.acquireFileLock()).toThrow(ConflictError);

      gate1.releaseFileLock();
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });
  });
});
