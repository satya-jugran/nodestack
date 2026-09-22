import { describe, it, expect } from 'vitest';
import { Container } from '../src/core/container/Container';
import { TOKENS } from '../src/core/container/Tokens';

describe('IoC Container', () => {
  it('should register and resolve instances', () => {
    const container = new Container();
    const myService = { name: 'TestService' };

    container.bindInstance(TOKENS.ConfigService, myService);

    expect(container.has(TOKENS.ConfigService)).toBe(true);
    expect(container.get(TOKENS.ConfigService)).toBe(myService);
  });

  it('should register and resolve factories', () => {
    const container = new Container();
    let count = 0;

    container.bindFactory('Counter', () => {
      count++;
      return { count };
    }, true);

    const first = container.get<{ count: number }>('Counter');
    const second = container.get<{ count: number }>('Counter');

    expect(first.count).toBe(1);
    expect(second.count).toBe(1); // singleton
    expect(first).toBe(second);
  });

  it('should resolve class constructors with dependencies', () => {
    const container = new Container();

    class DepA {
      public value = 'A';
    }

    class ServiceB {
      constructor(public depA: DepA) {}
    }

    container.bindClass('DepA', DepA);
    container.bindClass('ServiceB', ServiceB, ['DepA']);

    const b = container.get<ServiceB>('ServiceB');
    expect(b.depA).toBeInstanceOf(DepA);
    expect(b.depA.value).toBe('A');
  });

  it('should throw when token is not found', () => {
    const container = new Container();
    expect(() => container.get('UnknownToken')).toThrow();
  });
});
