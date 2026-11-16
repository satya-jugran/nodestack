import { ServiceIdentifier } from './Tokens';

type Factory<T> = (container: Container) => T;

interface Binding<T> {
  type: 'instance' | 'class' | 'factory';
  value?: T;
  factory?: Factory<T>;
  ctor?: { new (...args: any[]): T };
  dependencies?: ServiceIdentifier[];
  isSingleton: boolean;
}

export class Container {
  private bindings = new Map<ServiceIdentifier, Binding<any>>();
  private singletons = new Map<ServiceIdentifier, any>();
  private lockedTokens = new Set<ServiceIdentifier>();

  /**
   * Lock a token so its binding cannot be overridden.
   */
  public lockToken(token: ServiceIdentifier): this {
    this.lockedTokens.add(token);
    return this;
  }

  /**
   * Lock multiple tokens so their bindings cannot be overridden.
   */
  public lockTokens(tokens: Iterable<ServiceIdentifier>): this {
    for (const token of tokens) {
      this.lockedTokens.add(token);
    }
    return this;
  }

  /**
   * Check if a token is locked against re-registration.
   */
  public isLocked(token: ServiceIdentifier): boolean {
    return this.lockedTokens.has(token);
  }

  private checkNotLocked(token: ServiceIdentifier): void {
    if (this.lockedTokens.has(token)) {
      const name = typeof token === 'symbol' ? token.description : String(token);
      throw new Error(`[IoC Container] Cannot override locked service token: ${name}`);
    }
  }

  /**
   * Bind an instance directly to a token
   */
  public bindInstance<T>(token: ServiceIdentifier<T>, instance: T): this {
    this.checkNotLocked(token);
    this.bindings.set(token, {
      type: 'instance',
      value: instance,
      isSingleton: true,
    });
    this.singletons.set(token, instance);
    return this;
  }

  /**
   * Bind a factory function to a token
   */
  public bindFactory<T>(token: ServiceIdentifier<T>, factory: Factory<T>, isSingleton = true): this {
    this.checkNotLocked(token);
    this.bindings.set(token, {
      type: 'factory',
      factory,
      isSingleton,
    });
    return this;
  }

  /**
   * Bind a class constructor with its dependency tokens
   */
  public bindClass<T>(
    token: ServiceIdentifier<T>,
    ctor: { new (...args: any[]): T },
    dependencies: ServiceIdentifier[] = [],
    isSingleton = true
  ): this {
    this.checkNotLocked(token);
    this.bindings.set(token, {
      type: 'class',
      ctor,
      dependencies,
      isSingleton,
    });
    return this;
  }

  /**
   * Resolve an instance from the container
   */
  public get<T>(token: ServiceIdentifier<T>): T {
    if (this.singletons.has(token)) {
      return this.singletons.get(token);
    }

    const binding = this.bindings.get(token);
    if (!binding) {
      const name = typeof token === 'symbol' ? token.description : String(token);
      throw new Error(`[IoC Container] No binding found for token: ${name}`);
    }

    let instance: T;

    if (binding.type === 'instance') {
      instance = binding.value;
    } else if (binding.type === 'factory' && binding.factory) {
      instance = binding.factory(this);
    } else if (binding.type === 'class' && binding.ctor) {
      const resolvedDeps = (binding.dependencies || []).map((dep) => this.get(dep));
      instance = new binding.ctor(...resolvedDeps);
    } else {
      throw new Error(`[IoC Container] Invalid binding configuration for token: ${String(token)}`);
    }

    if (binding.isSingleton) {
      this.singletons.set(token, instance);
    }

    return instance;
  }

  /**
   * Check if a token is bound
   */
  public has(token: ServiceIdentifier): boolean {
    return this.bindings.has(token);
  }

  /**
   * Clear all container bindings and singletons
   */
  public async dispose(): Promise<void> {
    for (const [, instance] of this.singletons) {
      if (instance && typeof instance.dispose === 'function') {
        try {
          await instance.dispose();
        } catch (e) {
          console.error('[IoC Container] Error disposing service:', e);
        }
      }
    }
    this.bindings.clear();
    this.singletons.clear();
  }
}
