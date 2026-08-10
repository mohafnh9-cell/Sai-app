export type DynamicHttpConcurrencyAcquireOptions = {
  isCancelled?: () => boolean;
};

export type DynamicHttpConcurrencyLimiter = {
  acquire(options?: DynamicHttpConcurrencyAcquireOptions): Promise<void>;
  release(): void;
  readonly activeCount: number;
  readonly maxObserved: number;
  readonly maxConcurrent: number;
};

type Waiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  isCancelled?: () => boolean;
};

export function createDynamicHttpConcurrencyLimiter(
  maxConcurrent: number
): DynamicHttpConcurrencyLimiter {
  const limit = Math.max(1, maxConcurrent);
  let active = 0;
  let maxObserved = 0;
  const waitQueue: Waiter[] = [];

  function promoteWaiters(): void {
    while (waitQueue.length > 0 && active < limit) {
      const next = waitQueue.shift();
      if (!next) return;
      if (next.isCancelled?.()) {
        next.reject(new Error("Dynamic HTTP request cancelled"));
        continue;
      }
      active += 1;
      maxObserved = Math.max(maxObserved, active);
      next.resolve();
      return;
    }
  }

  async function acquire(options?: DynamicHttpConcurrencyAcquireOptions): Promise<void> {
    if (options?.isCancelled?.()) {
      throw new Error("Dynamic HTTP request cancelled");
    }
    if (active < limit) {
      active += 1;
      maxObserved = Math.max(maxObserved, active);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      waitQueue.push({
        resolve: () => resolve(),
        reject,
        isCancelled: options?.isCancelled,
      });
    });
  }

  function release(): void {
    active = Math.max(0, active - 1);
    promoteWaiters();
  }

  return {
    acquire,
    release,
    get activeCount() {
      return active;
    },
    get maxObserved() {
      return maxObserved;
    },
    get maxConcurrent() {
      return limit;
    },
  };
}
