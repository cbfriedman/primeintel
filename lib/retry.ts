const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

export type RetryOptions = {
  maxAttempts?: number;
  label?: string;
  isRetryable?: (err: unknown) => boolean;
};

function jitteredDelay(baseMs: number): number {
  return Math.round(baseMs * (0.8 + Math.random() * 0.4));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 2;
  const isRetryable = options.isRetryable ?? (() => true);
  const label = options.label ?? 'operation';

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = jitteredDelay(
        DEFAULT_RETRY_DELAYS_MS[Math.min(attempt - 1, DEFAULT_RETRY_DELAYS_MS.length - 1)],
      );
      console.log(`[retry] ${label}: attempt ${attempt + 1}/${maxAttempts} in ${delay}ms...`);
      await sleep(delay);
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt === maxAttempts - 1) {
        throw err;
      }

      console.log(
        `[retry] ${label}: attempt ${attempt + 1} failed (will retry): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  throw lastError;
}
