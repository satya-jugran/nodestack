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
  ): void {
    if (typeof collectionOrHandler === 'string' && handler) {
      this.beforeCreateHooks.push({ collection: collectionOrHandler, handler });
    } else if (typeof collectionOrHandler === 'function') {
      this.beforeCreateHooks.push({ handler: collectionOrHandler });
    }
  }

  public onRecordAfterCreate(
    collectionOrHandler: string | HookHandler<RecordAfterEventContext>,
    handler?: HookHandler<RecordAfterEventContext>
  ): void {
    if (typeof collectionOrHandler === 'string' && handler) {
      this.afterCreateHooks.push({ collection: collectionOrHandler, handler });
    } else if (typeof collectionOrHandler === 'function') {
      this.afterCreateHooks.push({ handler: collectionOrHandler });
    }
  }

  public onRecordBeforeUpdate(
    collectionOrHandler: string | HookHandler<RecordBeforeEventContext>,
    handler?: HookHandler<RecordBeforeEventContext>
  ): void {
    if (typeof collectionOrHandler === 'string' && handler) {
      this.beforeUpdateHooks.push({ collection: collectionOrHandler, handler });
    } else if (typeof collectionOrHandler === 'function') {
      this.beforeUpdateHooks.push({ handler: collectionOrHandler });
    }
  }

  public onRecordAfterUpdate(
    collectionOrHandler: string | HookHandler<RecordAfterEventContext>,
    handler?: HookHandler<RecordAfterEventContext>
  ): void {
    if (typeof collectionOrHandler === 'string' && handler) {
      this.afterUpdateHooks.push({ collection: collectionOrHandler, handler });
    } else if (typeof collectionOrHandler === 'function') {
      this.afterUpdateHooks.push({ handler: collectionOrHandler });
    }
  }

  public onRecordBeforeDelete(
    collectionOrHandler: string | HookHandler<RecordBeforeEventContext>,
    handler?: HookHandler<RecordBeforeEventContext>
  ): void {
    if (typeof collectionOrHandler === 'string' && handler) {
      this.beforeDeleteHooks.push({ collection: collectionOrHandler, handler });
    } else if (typeof collectionOrHandler === 'function') {
      this.beforeDeleteHooks.push({ handler: collectionOrHandler });
    }
  }

  public onRecordAfterDelete(
    collectionOrHandler: string | HookHandler<RecordAfterEventContext>,
    handler?: HookHandler<RecordAfterEventContext>
  ): void {
    if (typeof collectionOrHandler === 'string' && handler) {
      this.afterDeleteHooks.push({ collection: collectionOrHandler, handler });
    } else if (typeof collectionOrHandler === 'function') {
      this.afterDeleteHooks.push({ handler: collectionOrHandler });
    }
  }

  public onBeforeServe(handler: HookHandler<ServeEventContext>): void {
    this.beforeServeHooks.push(handler);
  }

  public onAfterServe(handler: HookHandler<ServeEventContext>): void {
    this.afterServeHooks.push(handler);
  }

  public onRecordAuthRequest(
    collectionOrHandler: string | HookHandler<AuthEventContext>,
    handler?: HookHandler<AuthEventContext>
  ): void {
    if (typeof collectionOrHandler === 'string' && handler) {
      this.authHooks.push({ collection: collectionOrHandler, handler });
    } else if (typeof collectionOrHandler === 'function') {
      this.authHooks.push({ handler: collectionOrHandler });
    }
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
    httpContext?: any
  ): Promise<void> {
    const ctx: RecordAfterEventContext = {
      collection,
      record,
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
}
