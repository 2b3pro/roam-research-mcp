import { describe, it, expect } from 'vitest';
import {
  generateBatchActions,
  filterActions,
  groupActionsByType,
  summarizeActions,
} from './actions.js';
import type { DiffResult } from './types.js';
import type { RoamBatchAction } from '../types/roam.js';

describe('generateBatchActions', () => {
  function createDiffResult(
    creates: RoamBatchAction[] = [],
    updates: RoamBatchAction[] = [],
    moves: RoamBatchAction[] = [],
    deletes: RoamBatchAction[] = []
  ): DiffResult {
    return {
      creates,
      updates,
      moves,
      deletes,
      preservedUids: new Set(),
    };
  }

  it('returns actions in correct order: creates, moves, updates, deletes', () => {
    const diff = createDiffResult(
      [{ action: 'create-block', block: { string: 'new' }, location: { 'parent-uid': 'p', order: 0 } }],
      [{ action: 'update-block', block: { uid: 'u1', string: 'updated' } }],
      [{ action: 'move-block', block: { uid: 'u2' }, location: { 'parent-uid': 'p', order: 1 } }],
      [{ action: 'delete-block', block: { uid: 'u3' } }]
    );

    const actions = generateBatchActions(diff);

    expect(actions[0].action).toBe('create-block');
    expect(actions[1].action).toBe('move-block');
    expect(actions[2].action).toBe('update-block');
    expect(actions[3].action).toBe('delete-block');
  });

  it('reverses delete order for child-before-parent deletion', () => {
    const diff = createDiffResult(
      [],
      [],
      [],
      [
        { action: 'delete-block', block: { uid: 'parent' } },
        { action: 'delete-block', block: { uid: 'child' } },
      ]
    );

    const actions = generateBatchActions(diff);

    // Deletes should be reversed
    expect((actions[0] as any).block.uid).toBe('child');
    expect((actions[1] as any).block.uid).toBe('parent');
  });

  it('returns empty array for empty diff', () => {
    const diff = createDiffResult();

    const actions = generateBatchActions(diff);

    expect(actions).toEqual([]);
  });

  it('preserves all actions without modification', () => {
    const createAction = {
      action: 'create-block' as const,
      block: { uid: 'new1', string: 'Test', heading: 2 },
      location: { 'parent-uid': 'page', order: 0 },
    };
    const diff = createDiffResult([createAction]);

    const actions = generateBatchActions(diff);

    expect(actions[0]).toEqual(createAction);
  });
});

describe('filterActions', () => {
  const allActions: RoamBatchAction[] = [
    { action: 'create-block', block: { string: 'new' }, location: { 'parent-uid': 'p', order: 0 } },
    { action: 'update-block', block: { uid: 'u1', string: 'updated' } },
    { action: 'move-block', block: { uid: 'u2' }, location: { 'parent-uid': 'p', order: 1 } },
    { action: 'delete-block', block: { uid: 'u3' } },
  ];

  it('filters to only specified action types', () => {
    const creates = filterActions(allActions, ['create-block']);

    expect(creates.length).toBe(1);
    expect(creates[0].action).toBe('create-block');
  });

  it('supports multiple action types', () => {
    const modifying = filterActions(allActions, ['create-block', 'update-block']);

    expect(modifying.length).toBe(2);
  });

  it('returns empty array when no matches', () => {
    const emptyActions: RoamBatchAction[] = [];

    const result = filterActions(emptyActions, ['create-block']);

    expect(result).toEqual([]);
  });
});

describe('groupActionsByType', () => {
  it('groups actions by their type', () => {
    const actions: RoamBatchAction[] = [
      { action: 'create-block', block: { string: 'a' }, location: { 'parent-uid': 'p', order: 0 } },
      { action: 'create-block', block: { string: 'b' }, location: { 'parent-uid': 'p', order: 1 } },
      { action: 'update-block', block: { uid: 'u1', string: 'c' } },
      { action: 'delete-block', block: { uid: 'u2' } },
    ];

    const grouped = groupActionsByType(actions);

    expect(grouped.creates.length).toBe(2);
    expect(grouped.updates.length).toBe(1);
    expect(grouped.moves.length).toBe(0);
    expect(grouped.deletes.length).toBe(1);
  });

  it('returns empty arrays for missing types', () => {
    const actions: RoamBatchAction[] = [];

    const grouped = groupActionsByType(actions);

    expect(grouped.creates).toEqual([]);
    expect(grouped.updates).toEqual([]);
    expect(grouped.moves).toEqual([]);
    expect(grouped.deletes).toEqual([]);
  });
});

describe('summarizeActions', () => {
  it('summarizes action counts', () => {
    const actions: RoamBatchAction[] = [
      { action: 'create-block', block: { string: 'a' }, location: { 'parent-uid': 'p', order: 0 } },
      { action: 'create-block', block: { string: 'b' }, location: { 'parent-uid': 'p', order: 1 } },
      { action: 'update-block', block: { uid: 'u1', string: 'c' } },
      { action: 'delete-block', block: { uid: 'u2' } },
    ];

    const summary = summarizeActions(actions);

    expect(summary).toBe('2 create(s), 1 update(s), 1 delete(s)');
  });

  it('returns "No changes" for empty actions', () => {
    const summary = summarizeActions([]);

    expect(summary).toBe('No changes');
  });

  it('only includes non-zero counts', () => {
    const actions: RoamBatchAction[] = [
      { action: 'update-block', block: { uid: 'u1', string: 'updated' } },
    ];

    const summary = summarizeActions(actions);

    expect(summary).toBe('1 update(s)');
    expect(summary).not.toContain('create');
    expect(summary).not.toContain('move');
    expect(summary).not.toContain('delete');
  });

  it('includes moves when present', () => {
    const actions: RoamBatchAction[] = [
      { action: 'move-block', block: { uid: 'u1' }, location: { 'parent-uid': 'p', order: 0 } },
      { action: 'move-block', block: { uid: 'u2' }, location: { 'parent-uid': 'p', order: 1 } },
    ];

    const summary = summarizeActions(actions);

    expect(summary).toBe('2 move(s)');
  });
});
