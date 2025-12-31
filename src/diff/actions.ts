/**
 * Action Generator
 *
 * Generates correctly ordered batch actions from a DiffResult.
 * The order is critical for Roam API correctness:
 * 1. Creates (top-down to ensure parents exist before children)
 * 2. Moves (reposition existing blocks)
 * 3. Updates (text/heading changes)
 * 4. Deletes (bottom-up; reverse order to delete children before parents)
 */

import type { DiffResult } from './types.js';
import type { RoamBatchAction } from '../types/roam.js';

/**
 * Generate a correctly ordered array of batch actions from a DiffResult.
 *
 * The ordering ensures:
 * - Parent blocks are created before their children
 * - Blocks are moved before text updates (in case moves affect siblings)
 * - Children are deleted before their parents
 *
 * @param diff - The DiffResult containing categorized actions
 * @returns Ordered array of batch actions ready for Roam API
 */
export function generateBatchActions(diff: DiffResult): RoamBatchAction[] {
  const actions: RoamBatchAction[] = [];

  // 1. Creates (in markdown order, parents before children)
  // The creates are already in the correct order from diffBlockTrees
  actions.push(...diff.creates);

  // 2. Moves (reposition existing blocks)
  actions.push(...diff.moves);

  // 3. Updates (text/heading changes)
  actions.push(...diff.updates);

  // 4. Deletes (reversed to delete children before parents)
  // This is important because Roam will fail if you try to delete
  // a parent block while it still has children
  actions.push(...[...diff.deletes].reverse());

  return actions;
}

/**
 * Filter actions to only include specific action types.
 * Useful for dry-run analysis or debugging.
 */
export function filterActions(
  actions: RoamBatchAction[],
  types: Array<'create-block' | 'update-block' | 'move-block' | 'delete-block'>
): RoamBatchAction[] {
  const typeSet = new Set(types);
  return actions.filter((a) => typeSet.has(a.action as any));
}

/**
 * Group actions by their type for analysis.
 */
export function groupActionsByType(actions: RoamBatchAction[]): {
  creates: RoamBatchAction[];
  updates: RoamBatchAction[];
  moves: RoamBatchAction[];
  deletes: RoamBatchAction[];
} {
  const creates: RoamBatchAction[] = [];
  const updates: RoamBatchAction[] = [];
  const moves: RoamBatchAction[] = [];
  const deletes: RoamBatchAction[] = [];

  for (const action of actions) {
    switch (action.action) {
      case 'create-block':
        creates.push(action);
        break;
      case 'update-block':
        updates.push(action);
        break;
      case 'move-block':
        moves.push(action);
        break;
      case 'delete-block':
        deletes.push(action);
        break;
    }
  }

  return { creates, updates, moves, deletes };
}

/**
 * Summarize actions for logging purposes.
 */
export function summarizeActions(actions: RoamBatchAction[]): string {
  const grouped = groupActionsByType(actions);
  const parts: string[] = [];

  if (grouped.creates.length > 0) {
    parts.push(`${grouped.creates.length} create(s)`);
  }
  if (grouped.moves.length > 0) {
    parts.push(`${grouped.moves.length} move(s)`);
  }
  if (grouped.updates.length > 0) {
    parts.push(`${grouped.updates.length} update(s)`);
  }
  if (grouped.deletes.length > 0) {
    parts.push(`${grouped.deletes.length} delete(s)`);
  }

  if (parts.length === 0) {
    return 'No changes';
  }

  return parts.join(', ');
}
