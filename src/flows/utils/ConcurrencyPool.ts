/**
 * Bounded worker pool for executing async tasks concurrently.
 * Used for Map states without requiring external ESM packages.
 */
export class ConcurrencyPool {
  /**
   * Maps an array of items using an async mapper function with a concurrency ceiling.
   */
  public static async map<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
    concurrency = 5
  ): Promise<R[]> {
    if (items.length === 0) {
      return [];
    }

    const limit = Math.max(1, concurrency);
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index], index);
      }
    };

    const workers: Promise<void>[] = [];
    const workerCount = Math.min(limit, items.length);

    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    return results;
  }
}
