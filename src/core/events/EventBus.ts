import {
  HookHandler,
  RecordBeforeEventContext,
  RecordAfterEventContext,
  AuthEventContext,
  ServeEventContext,
} from './types';
import { AppError } from '../errors/AppError';

export class EventBus {
  private beforeCreateHooks: Array<{ collection?: string; handler: HookHandler<RecordBeforeEventContext> }> = [];
  private afterCreateHooks: Array<{ collection?: string; handler: HookHandler<RecordAfterEventContext> }> = [];
  private beforeUpdateHooks: Array<{ collection?: string; handler: HookHandler<RecordBeforeEventContext> }> = [];
  private afterUpdateHooks: Array<{ collection?: string; handler: HookHandler<RecordAfterEventContext> }> = [];
  private beforeDeleteHooks: Array<{ collection?: string; handler: HookHandler<RecordBeforeEventContext> }> = [];
  private afterDeleteHooks: Array<{ collection?: string; handler: HookHandler<RecordAfterEventContext> }> = [];
  private beforeServeHooks: Array<HookHandler<ServeEventContext>> = [];
  private afterServeHooks: Array<HookHandler<ServeEventContext>> = [];
  private authHooks: Array<{ collection?: string; handler: HookHandler<AuthEventContext> }> = [];

  // Register Hooks
  public onRecordBeforeCreate(
    collectionOrHandler: string | HookHandler<RecordBeforeEventContext>,
    handler?: HookHandler<RecordBeforeEventContext>
  ): () => void {
    let item: { collection?: string; handler: HookHandler<RecordBeforeEventContext> };
    if (typeof collectionOrHandler === 'string' && handler) {
      item = { collection: collectionOrHandler, handler };
    } else if (typeof collectionOrHandler === 'function') {
      item = { handler: collectionOrHandler };
    } else {
      return () => {};
    }
    this.beforeCreateHooks.push(item);
    return () => {
      const idx = this.beforeCreateHooks.indexOf(item);
      if (idx !== -1) {
        this.beforeCreateHooks.splice(idx, 1);
      }
    };
  }

  public offRecordBeforeCreate(handler: HookHandler<RecordBeforeEventContext>): void {
    this.beforeCreateHooks = this.beforeCreateHooks.filter((h) => h.handler !== handler);
  }

  public onRecordAfterCreate(
    collectionOrHandler: string | HookHandler<RecordAfterEventContext>,
    handler?: HookHandler<RecordAfterEventContext>
  ): () => void {
    let item: { collection?: string; handler: HookHandler<RecordAfterEventContext> };
    if (typeof collectionOrHandler === 'string' && handler) {
      item = { collection: collectionOrHandler, handler };
    } else if (typeof collectionOrHandler === 'function') {
      item = { handler: collectionOrHandler };
    } else {
      return () => {};
    }
    this.afterCreateHooks.push(item);
    return () => {
      const idx = this.afterCreateHooks.indexOf(item);
      if (idx !== -1) {
        this.afterCreateHooks.splice(idx, 1);
      }
    };
  }

  public offRecordAfterCreate(handler: HookHandler<RecordAfterEventContext>): void {
    this.afterCreateHooks = this.afterCreateHooks.filter((h) => h.handler !== handler);
  }

  public onRecordBeforeUpdate(
    collectionOrHandler: string | HookHandler<RecordBeforeEventContext>,
    handler?: HookHandler<RecordBeforeEventContext>
  ): () => void {
    let item: { collection?: string; handler: HookHandler<RecordBeforeEventContext> };
    if (typeof collectionOrHandler === 'string' && handler) {
      item = { collection: collectionOrHandler, handler };
    } else if (typeof collectionOrHandler === 'function') {
      item = { handler: collectionOrHandler };
    } else {
      return () => {};
    }
    this.beforeUpdateHooks.push(item);
    return () => {
      const idx = this.beforeUpdateHooks.indexOf(item);
      if (idx !== -1) {
        this.beforeUpdateHooks.splice(idx, 1);
      }
    };
  }

  public offRecordBeforeUpdate(handler: HookHandler<RecordBeforeEventContext>): void {
    this.beforeUpdateHooks = this.beforeUpdateHooks.filter((h) => h.handler !== handler);
  }

  public onRecordAfterUpdate(
    collectionOrHandler: string | HookHandler<RecordAfterEventContext>,
    handler?: HookHandler<RecordAfterEventContext>
  ): () => void {
    let item: { collection?: string; handler: HookHandler<RecordAfterEventContext> };
    if (typeof collectionOrHandler === 'string' && handler) {
      item = { collection: collectionOrHandler, handler };
    } else if (typeof collectionOrHandler === 'function') {
      item = { handler: collectionOrHandler };
    } else {
      return () => {};
    }
    this.afterUpdateHooks.push(item);
    return () => {
      const idx = this.afterUpdateHooks.indexOf(item);
      if (idx !== -1) {
        this.afterUpdateHooks.splice(idx, 1);
      }
    };
  }

  public offRecordAfterUpdate(handler: HookHandler<RecordAfterEventContext>): void {
    this.afterUpdateHooks = this.afterUpdateHooks.filter((h) => h.handler !== handler);
  }

  public onRecordBeforeDelete(
    collectionOrHandler: string | HookHandler<RecordBeforeEventContext>,
    handler?: HookHandler<RecordBeforeEventContext>
  ): () => void {
    let item: { collection?: string; handler: HookHandler<RecordBeforeEventContext> };
    if (typeof collectionOrHandler === 'string' && handler) {
      item = { collection: collectionOrHandler, handler };
    } else if (typeof collectionOrHandler === 'function') {
      item = { handler: collectionOrHandler };
    } else {
      return () => {};
    }
    this.beforeDeleteHooks.push(item);
    return () => {
      const idx = this.beforeDeleteHooks.indexOf(item);
      if (idx !== -1) {
        this.beforeDeleteHooks.splice(idx, 1);
      }
    };
  }

  public offRecordBeforeDelete(handler: HookHandler<RecordBeforeEventContext>): void {
    this.beforeDeleteHooks = this.beforeDeleteHooks.filter((h) => h.handler !== handler);
  }

  public onRecordAfterDelete(
    collectionOrHandler: string | HookHandler<RecordAfterEventContext>,
    handler?: HookHandler<RecordAfterEventContext>
  ): () => void {
    let item: { collection?: string; handler: HookHandler<RecordAfterEventContext> };
    if (typeof collectionOrHandler === 'string' && handler) {
      item = { collection: collectionOrHandler, handler };
    } else if (typeof collectionOrHandler === 'function') {
      item = { handler: collectionOrHandler };
    } else {
      return () => {};
    }
    this.afterDeleteHooks.push(item);
    return () => {
      const idx = this.afterDeleteHooks.indexOf(item);
      if (idx !== -1) {
        this.afterDeleteHooks.splice(idx, 1);
      }
    };
  }

  public offRecordAfterDelete(handler: HookHandler<RecordAfterEventContext>): void {
    this.afterDeleteHooks = this.afterDeleteHooks.filter((h) => h.handler !== handler);
  }

  public onBeforeServe(handler: HookHandler<ServeEventContext>): () => void {
    this.beforeServeHooks.push(handler);
    return () => {
      const idx = this.beforeServeHooks.indexOf(handler);
      if (idx !== -1) {
        this.beforeServeHooks.splice(idx, 1);
      }
    };
  }

  public offBeforeServe(handler: HookHandler<ServeEventContext>): void {
    this.beforeServeHooks = this.beforeServeHooks.filter((h) => h !== handler);
  }

  public onAfterServe(handler: HookHandler<ServeEventContext>): () => void {
    this.afterServeHooks.push(handler);
    return () => {
      const idx = this.afterServeHooks.indexOf(handler);
      if (idx !== -1) {
        this.afterServeHooks.splice(idx, 1);
      }
    };
  }

  public offAfterServe(handler: HookHandler<ServeEventContext>): void {
    this.afterServeHooks = this.afterServeHooks.filter((h) => h !== handler);
  }

  public onRecordAuthRequest(
    collectionOrHandler: string | HookHandler<AuthEventContext>,
    handler?: HookHandler<AuthEventContext>
  ): () => void {
    let item: { collection?: string; handler: HookHandler<AuthEventContext> };
    if (typeof collectionOrHandler === 'string' && handler) {
      item = { collection: collectionOrHandler, handler };
    } else if (typeof collectionOrHandler === 'function') {
      item = { handler: collectionOrHandler };
    } else {
      return () => {};
    }
    this.authHooks.push(item);
    return () => {
      const idx = this.authHooks.indexOf(item);
      if (idx !== -1) {
        this.authHooks.splice(idx, 1);
      }
    };
  }

  public offRecordAuthRequest(handler: HookHandler<AuthEventContext>): void {
    this.authHooks = this.authHooks.filter((h) => h.handler !== handler);
  }

  // Dispatchers
  public async triggerRecordBeforeCreate(
    collection: string,
    record: Record<string, any>,
    auth?: any,
    httpContext?: any
  ): Promise<Record<string, any>> {
    const ctx: RecordBeforeEventContext = {
      collection,
      record: { ...record },
      auth,
      httpContext,
      isCanceled: false,
      cancel(reason?: string) {
        this.isCanceled = true;
        this.cancelReason = reason;
      },
    };

    for (const hook of this.beforeCreateHooks) {
      if (!hook.collection || hook.collection === collection) {
        await hook.handler(ctx);
        if (ctx.isCanceled) {
          throw new AppError(ctx.cancelReason || 'Operation canceled by hook', 400);
        }
      }
    }

    return ctx.record;
  }

  public async triggerRecordAfterCreate(
    collection: string,
    record: Record<string, any>,
    auth?: any,
    httpContext?: any
  ): Promise<void> {
    const ctx: RecordAfterEventContext = {
      collection,
      record,
      auth,
      httpContext,
    };

    for (const hook of this.afterCreateHooks) {
      if (!hook.collection || hook.collection === collection) {
        await hook.handler(ctx);
      }
    }
  }

  public async triggerRecordBeforeUpdate(
    collection: string,
    record: Record<string, any>,
    auth?: any,
    httpContext?: any
  ): Promise<Record<string, any>> {
    const ctx: RecordBeforeEventContext = {
      collection,
      record: { ...record },
      auth,
      httpContext,
      isCanceled: false,
      cancel(reason?: string) {
        this.isCanceled = true;
        this.cancelReason = reason;
      },
    };

    for (const hook of this.beforeUpdateHooks) {
      if (!hook.collection || hook.collection === collection) {
        await hook.handler(ctx);
        if (ctx.isCanceled) {
          throw new AppError(ctx.cancelReason || 'Operation canceled by hook', 400);
        }
      }
    }

    return ctx.record;
  }

  public async triggerRecordAfterUpdate(
    collection: string,
    record: Record<string, any>,
    auth?: any,
    httpContext?: any,
    originalRecord?: Record<string, any>
  ): Promise<void> {
    const ctx: RecordAfterEventContext = {
      collection,
      record,
      originalRecord,
      auth,
      httpContext,
    };

    for (const hook of this.afterUpdateHooks) {
      if (!hook.collection || hook.collection === collection) {
        await hook.handler(ctx);
      }
    }
  }

  public async triggerRecordBeforeDelete(
    collection: string,
    record: Record<string, any>,
    auth?: any,
    httpContext?: any
  ): Promise<void> {
    const ctx: RecordBeforeEventContext = {
      collection,
      record,
      auth,
      httpContext,
      isCanceled: false,
      cancel(reason?: string) {
        this.isCanceled = true;
        this.cancelReason = reason;
      },
    };

    for (const hook of this.beforeDeleteHooks) {
      if (!hook.collection || hook.collection === collection) {
        await hook.handler(ctx);
        if (ctx.isCanceled) {
          throw new AppError(ctx.cancelReason || 'Operation canceled by hook', 400);
        }
      }
    }
  }

  public async triggerRecordAfterDelete(
    collection: string,
    record: Record<string, any>,
    auth?: any,
    httpContext?: any
  ): Promise<void> {
    const ctx: RecordAfterEventContext = {
      collection,
      record,
      auth,
      httpContext,
    };

    for (const hook of this.afterDeleteHooks) {
      if (!hook.collection || hook.collection === collection) {
        await hook.handler(ctx);
      }
    }
  }

  public async triggerBeforeServe(ctx: ServeEventContext): Promise<void> {
    for (const hook of this.beforeServeHooks) {
      await hook(ctx);
    }
  }

  public async triggerAfterServe(ctx: ServeEventContext): Promise<void> {
    for (const hook of this.afterServeHooks) {
      await hook(ctx);
    }
  }

  public async triggerAuthRequest(ctx: AuthEventContext): Promise<void> {
    for (const hook of this.authHooks) {
      if (!hook.collection || hook.collection === ctx.collection) {
        await hook.handler(ctx);
      }
    }
  }

  // --- Generic Custom Events ---
  private customEventHandlers = new Map<string, Array<(data?: any) => Promise<void> | void>>();

  public on(event: string, handler: (data?: any) => Promise<void> | void): () => void {
    if (!this.customEventHandlers.has(event)) {
      this.customEventHandlers.set(event, []);
    }
    this.customEventHandlers.get(event)!.push(handler);
    return () => this.off(event, handler);
  }

  public off(event: string, handler: (data?: any) => Promise<void> | void): void {
    const handlers = this.customEventHandlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) {
        handlers.splice(idx, 1);
      }
      if (handlers.length === 0) {
        this.customEventHandlers.delete(event);
      }
    }
  }

  public async emit(event: string, data?: any): Promise<void> {
    const handlers = this.customEventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        await handler(data);
      }
    }
  }
}
