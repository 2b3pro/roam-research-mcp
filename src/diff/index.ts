/**
 * Smart Diff Algorithm
 *
 * This module provides a diff algorithm for computing minimal update operations
 * when syncing markdown content to Roam Research. It preserves block UIDs where
 * possible and generates efficient batch actions.
 *
 * Usage:
 * ```typescript
 * import {
 *   parseExistingBlocks,
 *   markdownToBlocks,
 *   diffBlockTrees,
 *   generateBatchActions,
 *   getDiffStats
 * } from './diff/index.js';
 *
 * // 1. Parse existing page data
 * const existing = parseExistingBlocks(pageData);
 *
 * // 2. Convert new markdown to block structure
 * const newBlocks = markdownToBlocks(markdown, pageUid);
 *
 * // 3. Compute diff
 * const diff = diffBlockTrees(existing, newBlocks, pageUid);
 *
 * // 4. Generate ordered batch actions
 * const actions = generateBatchActions(diff);
 *
 * // 5. Check stats
 * const stats = getDiffStats(diff);
 * console.log(`Preserved ${stats.preserved} UIDs`);
 * ```
 */

// Types
export type {
  ExistingBlock,
  NewBlock,
  BlockRef,
  DiffResult,
  DiffStats,
  RoamApiBlock,
} from './types.js';

export { getDiffStats, isDiffEmpty } from './types.js';

// Parser
export {
  parseExistingBlock,
  parseExistingBlocks,
  flattenExistingBlocks,
  markdownToBlocks,
  getBlockDepth,
} from './parser.js';

// Matcher
export { normalizeText, normalizeForMatching, matchBlocks, groupByParent } from './matcher.js';

// Diff
export { diffBlockTrees, diffBlockLevel } from './diff.js';

// Actions
export {
  generateBatchActions,
  filterActions,
  groupActionsByType,
  summarizeActions,
} from './actions.js';
