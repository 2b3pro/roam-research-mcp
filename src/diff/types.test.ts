import { describe, it, expect } from 'vitest';
import { getDiffStats, isDiffEmpty } from './types.js';
import type { DiffResult } from './types.js';

function createDiffResult(
  createCount: number = 0,
  updateCount: number = 0,
  moveCount: number = 0,
  deleteCount: number = 0,
  preservedCount: number = 0
): DiffResult {
  return {
    creates: Array(createCount).fill({ action: 'create-block' }),
    updates: Array(updateCount).fill({ action: 'update-block' }),
    moves: Array(moveCount).fill({ action: 'move-block' }),
    deletes: Array(deleteCount).fill({ action: 'delete-block' }),
    preservedUids: new Set(Array(preservedCount).fill(null).map((_, i) => `uid${i}`)),
  };
}

describe('getDiffStats', () => {
  it('returns correct counts for all operation types', () => {
    const diff = createDiffResult(2, 3, 1, 4, 5);

    const stats = getDiffStats(diff);

    expect(stats.creates).toBe(2);
    expect(stats.updates).toBe(3);
    expect(stats.moves).toBe(1);
    expect(stats.deletes).toBe(4);
    expect(stats.preserved).toBe(5);
  });

  it('returns zeros for empty diff', () => {
    const diff = createDiffResult();

    const stats = getDiffStats(diff);

    expect(stats.creates).toBe(0);
    expect(stats.updates).toBe(0);
    expect(stats.moves).toBe(0);
    expect(stats.deletes).toBe(0);
    expect(stats.preserved).toBe(0);
  });
});

describe('isDiffEmpty', () => {
  it('returns true when no operations exist', () => {
    const diff = createDiffResult(0, 0, 0, 0, 5);

    expect(isDiffEmpty(diff)).toBe(true);
  });

  it('returns false when creates exist', () => {
    const diff = createDiffResult(1);

    expect(isDiffEmpty(diff)).toBe(false);
  });

  it('returns false when updates exist', () => {
    const diff = createDiffResult(0, 1);

    expect(isDiffEmpty(diff)).toBe(false);
  });

  it('returns false when moves exist', () => {
    const diff = createDiffResult(0, 0, 1);

    expect(isDiffEmpty(diff)).toBe(false);
  });

  it('returns false when deletes exist', () => {
    const diff = createDiffResult(0, 0, 0, 1);

    expect(isDiffEmpty(diff)).toBe(false);
  });

  it('ignores preserved count when checking empty', () => {
    const diff = createDiffResult(0, 0, 0, 0, 100);

    expect(isDiffEmpty(diff)).toBe(true);
  });
});
