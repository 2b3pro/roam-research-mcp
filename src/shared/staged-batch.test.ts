import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Graph } from '@roam-research/roam-api-sdk';

vi.mock('@roam-research/roam-api-sdk', () => ({
  batchActions: vi.fn(),
  Graph: vi.fn(),
}));

import { batchActions } from '@roam-research/roam-api-sdk';
import { executeStagedBatch, groupActionsByDependencyLevel } from './staged-batch.js';

const mockGraph = {} as Graph;
const batchMock = batchActions as unknown as ReturnType<typeof vi.fn>;

/** A two-level batch: one parent, one child that depends on it. */
function twoLevelActions() {
  return [
    { action: 'create-block', block: { uid: 'parent1', string: 'Parent' }, location: { 'parent-uid': 'page1', order: 0 } },
    { action: 'create-block', block: { uid: 'child1', string: 'Child' }, location: { 'parent-uid': 'parent1', order: 0 } },
  ];
}

const rateLimit = () => new Error('Too many requests, try again in a minute.');

// Zero delays so tests don't actually wait.
const fast = { delayBetweenLevels: 0, rateLimit: { initialDelayMs: 0, maxDelayMs: 0, maxRetries: 3 } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('groupActionsByDependencyLevel', () => {
  it('puts a child in a later level than the parent it depends on', () => {
    const levels = groupActionsByDependencyLevel(twoLevelActions());
    expect(levels).toHaveLength(2);
    expect(levels[0][0].block?.uid).toBe('parent1');
    expect(levels[1][0].block?.uid).toBe('child1');
  });

  it('keeps independent actions in a single level', () => {
    const levels = groupActionsByDependencyLevel([
      { action: 'create-block', block: { uid: 'a' }, location: { 'parent-uid': 'page1' } },
      { action: 'create-block', block: { uid: 'b' }, location: { 'parent-uid': 'page1' } },
    ]);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toHaveLength(2);
  });

  it('returns nothing for an empty batch', () => {
    expect(groupActionsByDependencyLevel([])).toEqual([]);
  });
});

describe('executeStagedBatch rate limiting', () => {
  it('retries a rate-limited level instead of abandoning the batch', async () => {
    // Level 0 gets rate limited once, then succeeds. Level 1 succeeds.
    batchMock
      .mockRejectedValueOnce(rateLimit())
      .mockResolvedValue({ created: true });

    const result = await executeStagedBatch(mockGraph, twoLevelActions(), fast);

    expect(result.success).toBe(true);
    expect(result.levelsExecuted).toBe(2);
    // 3 calls: level 0 fails, level 0 retries, level 1 succeeds.
    expect(batchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a rate limit that strikes on a later level', async () => {
    // This is the real-world failure: early levels commit, a later one is
    // throttled, and the page is left half-written.
    batchMock
      .mockResolvedValueOnce({ created: true })
      .mockRejectedValueOnce(rateLimit())
      .mockResolvedValue({ created: true });

    const result = await executeStagedBatch(mockGraph, twoLevelActions(), fast);

    expect(result.success).toBe(true);
    expect(batchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after the configured number of retries', async () => {
    batchMock.mockRejectedValue(rateLimit());

    await expect(
      executeStagedBatch(mockGraph, twoLevelActions(), {
        delayBetweenLevels: 0,
        rateLimit: { initialDelayMs: 0, maxDelayMs: 0, maxRetries: 2 },
      })
    ).rejects.toThrow(/level 0/);

    // Initial attempt + 2 retries.
    expect(batchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry an error that is not a rate limit', async () => {
    batchMock.mockRejectedValue(new Error('Invalid block UID'));

    await expect(executeStagedBatch(mockGraph, twoLevelActions(), fast)).rejects.toThrow(/Invalid block UID/);
    expect(batchMock).toHaveBeenCalledTimes(1);
  });

  it('names the level in the error so a caller can tell what was already written', async () => {
    batchMock.mockResolvedValueOnce({ created: true }).mockRejectedValue(new Error('boom'));

    await expect(executeStagedBatch(mockGraph, twoLevelActions(), fast)).rejects.toThrow(/level 1/);
  });

  it('does no work and reports nothing for an empty batch', async () => {
    const result = await executeStagedBatch(mockGraph, [], fast);
    expect(result).toEqual({ success: true, levelsExecuted: 0, totalActions: 0 });
    expect(batchMock).not.toHaveBeenCalled();
  });
});
