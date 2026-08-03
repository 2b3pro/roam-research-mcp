/**
 * Shared rate-limit retry.
 *
 * Roam throttles bursts of writes ("Too many requests, try again in a minute").
 * Every write path needs the same response — wait and retry with backoff — and
 * when one path lacks it the failure is expensive: a multi-level batch that dies
 * midway leaves a half-written page, and Roam has no undo to reverse it.
 *
 * This lived as a private method on BatchOperations, which is exactly why
 * executeStagedBatch was written without it. It belongs here so a new write path
 * can reach for it.
 */

import { isRateLimitError } from './errors.js';

export interface RateLimitRetryConfig {
  /** Retries AFTER the initial attempt, so N means up to N+1 calls. */
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RATE_LIMIT_RETRY: RateLimitRetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn`, retrying with exponential backoff while it fails with a rate-limit
 * error. Any other error is rethrown immediately — retrying a malformed request
 * just burns quota.
 *
 * Rethrows the last rate-limit error once retries are exhausted, so callers keep
 * whatever context they wrap it in.
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RateLimitRetryConfig> = {},
  onRetry?: (attempt: number, waitMs: number, error: unknown) => void
): Promise<T> {
  const { maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier } = {
    ...DEFAULT_RATE_LIMIT_RETRY,
    ...config,
  };

  let delay = initialDelayMs;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error)) throw error;
      lastError = error;

      if (attempt < maxRetries) {
        const waitMs = Math.min(delay, maxDelayMs);
        onRetry?.(attempt + 1, waitMs, error);
        await sleep(waitMs);
        delay *= backoffMultiplier;
      }
    }
  }

  throw lastError;
}
