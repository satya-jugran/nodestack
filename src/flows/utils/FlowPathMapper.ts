/**
 * Path mapper for Flow payloads.
 * Evaluates and mutates JSON objects based on dot/bracket path notations (e.g. $.items[0].id).
 */
export class FlowPathMapper {
  /**
   * Resolves a value from payload using path (e.g. "$.user.name" or "$.items[0]").
   * Returns defaultValue or undefined if path cannot be resolved.
   */
  public static get(target: any, path?: string, defaultValue?: any): any {
    if (!path || path === '$') {
      return target !== undefined ? target : defaultValue;
    }

    const segments = this.parsePath(path);
    let current = target;

    for (const segment of segments) {
      if (current === null || current === undefined) {
        return defaultValue;
      }
      current = current[segment];
    }

    return current !== undefined ? current : defaultValue;
  }

  /**
   * Immutably sets a value in payload at target path and returns the modified object.
   * If path is "$" or undefined, replaces root value entirely.
   */
  public static set(target: any, path: string | undefined, value: any): any {
    if (!path || path === '$') {
      return value;
    }

    const segments = this.parsePath(path);
    if (segments.length === 0) {
      return value;
    }

    const root = this.clone(target ?? {});
    let current = root;

    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const nextSegment = segments[i + 1];
      const isNextNumeric = typeof nextSegment === 'number';

      if (current[segment] === null || typeof current[segment] !== 'object') {
        current[segment] = isNextNumeric ? [] : {};
      } else {
        current[segment] = this.clone(current[segment]);
      }

      current = current[segment];
    }

    const lastSegment = segments[segments.length - 1];
    current[lastSegment] = value;
    return root;
  }

  /**
   * Resolves the input payload before a state executes.
   */
  public static resolveInput(payload: any, inputPath?: string): any {
    if (!inputPath || inputPath === '$') {
      return this.clone(payload);
    }
    return this.get(payload, inputPath);
  }

  /**
   * Merges the state result into the payload based on resultPath.
   */
  public static applyResult(payload: any, result: any, resultPath?: string): any {
    if (resultPath === null || resultPath === '') {
      return payload; // discard result
    }
    if (!resultPath || resultPath === '$') {
      return result; // replace root
    }
    return this.set(payload, resultPath, result);
  }

  /**
   * Filters the final payload returned by a state based on outputPath.
   */
  public static resolveOutput(payload: any, outputPath?: string): any {
    if (!outputPath || outputPath === '$') {
      return payload;
    }
    return this.get(payload, outputPath);
  }

  private static parsePath(path: string): (string | number)[] {
    const cleanPath = path.startsWith('$.') ? path.slice(2) : path.startsWith('$') ? path.slice(1) : path;
    if (!cleanPath) {
      return [];
    }

    const tokens: (string | number)[] = [];
    const regex = /([^[.\]]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(cleanPath)) !== null) {
      if (match[2] !== undefined) {
        tokens.push(parseInt(match[2], 10));
      } else if (match[1] !== undefined) {
        tokens.push(match[1]);
      }
    }

    return tokens;
  }

  private static clone<T>(val: T): T {
    if (val === undefined || val === null || typeof val !== 'object') {
      return val;
    }
    return JSON.parse(JSON.stringify(val));
  }
}
