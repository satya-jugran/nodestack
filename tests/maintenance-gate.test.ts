import { describe, it, expect, vi } from 'vitest';
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
});
