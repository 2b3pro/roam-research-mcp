/**
 * Staged batch executor for Roam API.
 *
 * Solves the race condition where child blocks reference parent UIDs
 * that are also being created in the same batch. By analyzing dependencies
 * and executing in topological order (by level), we ensure parents exist
 * before their children are created.
 */

import { Graph, batchActions } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { withRateLimitRetry, type RateLimitRetryConfig } from './retry.js';

/**
 * Generic batch action type that works with various action formats
 * used throughout the codebase. The key fields we care about are:
 * - action: the action type
 * - location['parent-uid']: the parent block UID
 * - block.uid: the UID being created
 */
export interface StagedBatchAction {
  action?: string;
  location?: {
    'parent-uid'?: string;
    order?: number | 'first' | 'last' | string;
  };
  block?: {
    uid?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface StagedBatchOptions {
  /** Delay in ms between levels. Default: 100 */
  delayBetweenLevels?: number;
  /** Context string for error messages */
  context?: string;
  /**
   * Rate-limit retry policy for each level. Defaults to DEFAULT_RATE_LIMIT_RETRY.
   * Levels are committed as they succeed, so without retry a throttled level
   * leaves the earlier ones written and the rest missing.
   */
  rateLimit?: Partial<RateLimitRetryConfig>;
}

/**
 * Groups batch actions by dependency level.
 *
 * Level 0: Actions whose parent-uid is NOT created by another action in the batch
 * Level 1: Actions whose parent-uid is created by a Level 0 action
 * Level N: Actions whose parent-uid is created by a Level N-1 action
 *
 * @param actions - Flat array of batch actions
 * @returns Array of action arrays, grouped by level
 */
export function groupActionsByDependencyLevel(actions: StagedBatchAction[]): StagedBatchAction[][] {
  if (actions.length === 0) return [];

  // Build set of UIDs being created in this batch
  const createdUids = new Set<string>();
  for (const action of actions) {
    if (action.action === 'create-block' && action.block?.uid) {
      createdUids.add(action.block.uid);
    }
  }

  // Build dependency map: action index -> parent action index (or -1 if external parent)
  const dependsOn = new Map<number, number>();
  const uidToIndex = new Map<string, number>();

  // First pass: map UIDs to action indices
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.action === 'create-block' && action.block?.uid) {
      uidToIndex.set(action.block.uid, i);
    }
  }

  // Second pass: determine dependencies
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const parentUid = action.location?.['parent-uid'];

    if (parentUid && createdUids.has(parentUid)) {
      // This action depends on another action in the batch
      const parentIndex = uidToIndex.get(parentUid);
      if (parentIndex !== undefined) {
        dependsOn.set(i, parentIndex);
      }
    } else {
      // External parent (already exists in Roam)
      dependsOn.set(i, -1);
    }
  }

  // Calculate levels using BFS-like approach
  const levels = new Map<number, number>(); // action index -> level

  // Initialize: actions with external parents are level 0
  for (let i = 0; i < actions.length; i++) {
    if (dependsOn.get(i) === -1) {
      levels.set(i, 0);
    }
  }

  // Propagate levels
  let changed = true;
  let iterations = 0;
  const maxIterations = actions.length + 1; // Prevent infinite loops

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (let i = 0; i < actions.length; i++) {
      if (levels.has(i)) continue; // Already assigned

      const parentIndex = dependsOn.get(i);
      if (parentIndex !== undefined && parentIndex !== -1 && levels.has(parentIndex)) {
        levels.set(i, levels.get(parentIndex)! + 1);
        changed = true;
      }
    }
  }

  // Check for unassigned actions (circular dependencies or missing parents)
  for (let i = 0; i < actions.length; i++) {
    if (!levels.has(i)) {
      // This shouldn't happen with valid input, but handle gracefully
      // Assign to level 0 as fallback
      levels.set(i, 0);
    }
  }

  // Group by level
  const maxLevel = Math.max(...levels.values());
  const grouped: StagedBatchAction[][] = [];

  for (let level = 0; level <= maxLevel; level++) {
    grouped[level] = [];
  }

  for (let i = 0; i < actions.length; i++) {
    const level = levels.get(i) ?? 0;
    grouped[level].push(actions[i]);
  }

  // Filter out empty levels
  return grouped.filter(level => level.length > 0);
}

/**
 * Executes batch actions in staged order, ensuring parent blocks exist
 * before their children are created.
 *
 * @param graph - Roam graph connection
 * @param actions - Flat array of batch actions
 * @param options - Execution options
 * @returns Promise that resolves when all actions are complete
 */
export async function executeStagedBatch(
  graph: Graph,
  actions: StagedBatchAction[],
  options: StagedBatchOptions = {}
): Promise<{ success: boolean; levelsExecuted: number; totalActions: number }> {
  const { delayBetweenLevels = 100, context = 'batch operation', rateLimit } = options;

  if (actions.length === 0) {
    return { success: true, levelsExecuted: 0, totalActions: 0 };
  }

  const actionsByLevel = groupActionsByDependencyLevel(actions);

  for (let level = 0; level < actionsByLevel.length; level++) {
    const levelActions = actionsByLevel[level];
    if (levelActions.length === 0) continue;

    try {
      const result = await withRateLimitRetry(
        () => batchActions(graph, {
          action: 'batch-actions',
          actions: levelActions
        }),
        rateLimit,
        (attempt, waitMs) => {
          console.error(
            `[staged-batch] ${context}: level ${level} rate limited, retrying in ${waitMs}ms (attempt ${attempt})`
          );
        }
      );

      if (!result) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute ${context} at level ${level} - no result returned`
        );
      }
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to execute ${context} at level ${level}: ${error.message}`
      );
    }

    // Delay between levels to ensure parent blocks are committed
    if (level < actionsByLevel.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenLevels));
    }
  }

  return {
    success: true,
    levelsExecuted: actionsByLevel.length,
    totalActions: actions.length
  };
}
