import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Graph } from '@roam-research/roam-api-sdk';

/**
 * Characterisation tests for the batch write path's rate-limit handling.
 *
 * Written BEFORE folding `BatchOperations.executeWithRetry` onto the shared
 * `withRateLimitRetry`, because the two differ in what they throw once retries
 * run out: the private version synthesised a fresh Error carrying `isRateLimit`
 * and `retryAfterMs`, while the shared helper rethrows the original. The
 * question these answer is whether that difference is observable in what a
 * caller actually gets back.
 */

const batchActions = vi.fn();
const ensurePagesExist = vi.fn();

vi.mock('@roam-research/roam-api-sdk', () => ({
  batchActions: (...args: unknown[]) => batchActions(...args),
}));

vi.mock('../../shared/page-validator.js', () => ({
  ensurePagesExist: (...args: unknown[]) => ensurePagesExist(...args),
}));

const { BatchOperations } = await import('./batch.js');

/** Roam's actual throttle message, which is what the detector keys on. */
const rateLimited = () => new Error('Too many requests, try again in a minute.');

const graph = {} as Graph;

/** Zero delays: this suite is about counts and shapes, not wall-clock. */
const ops = () =>
  new BatchOperations(graph, { initialDelayMs: 0, maxDelayMs: 60000, maxRetries: 3 });

const oneBlock = [
  { action: 'create-block', location: { 'parent-uid': 'abcdefghi', order: 'last' }, string: 'hello' },
];

beforeEach(() => {
  vi.clearAllMocks();
  ensurePagesExist.mockResolvedValue({ checked: 0, created: 0, cached: 0 });
});

describe('rate-limited batch writes', () => {
  it('retries and succeeds without the caller ever seeing the throttle', async () => {
    batchActions
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited())
      .mockResolvedValueOnce({});

    const result = await ops().processBatch(oneBlock);

    expect(batchActions).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    expect(result.actions_attempted).toBe(1);
  });

  it('gives up after maxRetries and reports RATE_LIMIT with a backoff hint', async () => {
    batchActions.mockRejectedValue(rateLimited());

    const result = await ops().processBatch(oneBlock);

    // maxRetries counts retries AFTER the first attempt: 1 + 3.
    expect(batchActions).toHaveBeenCalledTimes(4);
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'RATE_LIMIT',
      recovery: { retry_after_ms: 60000 },
    });
  });

  it('honours a non-default maxDelayMs in the backoff hint', async () => {
    // The value a caller is told to wait must come from that caller's config,
    // not from whatever the error object happened to be carrying.
    batchActions.mockRejectedValue(rateLimited());

    const custom = new BatchOperations(graph, { initialDelayMs: 0, maxDelayMs: 5000, maxRetries: 1 });
    const result = await custom.processBatch(oneBlock);

    expect(batchActions).toHaveBeenCalledTimes(2);
    expect(result.error).toMatchObject({ recovery: { retry_after_ms: 5000 } });
  });

  it('never returns a uid_map when the write failed', async () => {
    // The point of the uid_map is to name blocks that now exist. Handing one
    // back for a batch that did not commit sends the caller after phantoms.
    batchActions.mockRejectedValue(rateLimited());

    const result = await ops().processBatch([
      {
        action: 'create-block',
        location: { 'parent-uid': 'abcdefghi', order: 'last' },
        string: 'parent',
        uid: '{{uid:p1}}',
      },
    ]);

    expect(result.success).toBe(false);
    expect(result.uid_map).toBeUndefined();
  });
});

describe('errors that are not rate limits', () => {
  it('fails immediately rather than burning quota on a retry', async () => {
    batchActions.mockRejectedValue(new Error('Invalid block string'));

    const result = await ops().processBatch(oneBlock);

    expect(batchActions).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'TRANSACTION_FAILED' });
  });

  it('retries a missing parent once, for Roam\'s eventual consistency', async () => {
    batchActions
      .mockRejectedValueOnce(new Error("Parent entity doesn't exist"))
      .mockResolvedValueOnce({});

    const result = await ops().processBatch(oneBlock);

    expect(batchActions).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  it('reports PARENT_ENTITY_NOT_FOUND when the second attempt fails too', async () => {
    batchActions.mockRejectedValue(new Error("Parent entity doesn't exist"));

    const result = await ops().processBatch(oneBlock);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'PARENT_ENTITY_NOT_FOUND' });
  });
});

describe('successful batches', () => {
  it('returns the placeholder to UID mapping', async () => {
    batchActions.mockResolvedValue({});

    const result = await ops().processBatch([
      {
        action: 'create-block',
        location: { 'parent-uid': 'abcdefghi', order: 'last' },
        string: 'parent',
        uid: '{{uid:p1}}',
      },
      {
        action: 'create-block',
        location: { 'parent-uid': '{{uid:p1}}', order: 'last' },
        string: 'child',
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.uid_map!.p1).toMatch(/^[A-Za-z0-9_-]{9}$/);

    // The placeholder must be gone from what actually went to Roam, in both the
    // block's own uid and the child's parent reference.
    const sent = JSON.stringify(batchActions.mock.calls[0][1]);
    expect(sent).not.toContain('{{uid:');
    expect(sent).toContain(result.uid_map!.p1);
  });

  it('omits uid_map entirely when no placeholders were used', async () => {
    batchActions.mockResolvedValue({});
    const result = await ops().processBatch(oneBlock);
    expect(result.success).toBe(true);
    expect(result.uid_map).toBeUndefined();
  });
});
