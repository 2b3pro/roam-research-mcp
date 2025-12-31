/**
 * Diff Algorithm Types
 *
 * Type definitions for the smart diff algorithm that computes minimal
 * update operations when syncing markdown content to Roam.
 */

import type { RoamBatchAction } from '../types/roam.js';

/**
 * Represents a block fetched from Roam API.
 * Contains the current state of a block in the graph.
 */
export interface ExistingBlock {
  uid: string;
  text: string;
  order: number;
  heading: number | null;
  children: ExistingBlock[];
  parentUid: string | null;
}

/**
 * Reference to a block by its UID.
 * Used to establish parent-child relationships in new blocks.
 */
export interface BlockRef {
  blockUid: string;
}

/**
 * Represents a block generated from markdown (to be created/matched).
 * Contains the desired state of a block.
 */
export interface NewBlock {
  ref: BlockRef;
  text: string;
  parentRef: BlockRef | null;
  order: number | 'last';
  open: boolean;
  heading: number | null;
}

/**
 * Result of diffing two block trees.
 * Contains categorized batch actions and preserved UIDs.
 */
export interface DiffResult {
  creates: RoamBatchAction[];
  updates: RoamBatchAction[];
  moves: RoamBatchAction[];
  deletes: RoamBatchAction[];
  preservedUids: Set<string>;
}

/**
 * Statistics about the diff result.
 * Useful for logging and understanding the scope of changes.
 */
export interface DiffStats {
  creates: number;
  updates: number;
  moves: number;
  deletes: number;
  preserved: number;
}

/**
 * Raw Roam block structure as returned from API queries.
 * Uses Roam's keyword-prefixed property names.
 */
export interface RoamApiBlock {
  ':block/uid'?: string;
  ':block/string'?: string;
  ':block/order'?: number;
  ':block/heading'?: number | null;
  ':block/children'?: RoamApiBlock[];
  [key: string]: unknown;
}

/**
 * Extract statistics from a DiffResult.
 */
export function getDiffStats(result: DiffResult): DiffStats {
  return {
    creates: result.creates.length,
    updates: result.updates.length,
    moves: result.moves.length,
    deletes: result.deletes.length,
    preserved: result.preservedUids.size,
  };
}

/**
 * Check if a diff result contains no changes.
 */
export function isDiffEmpty(result: DiffResult): boolean {
  return (
    result.creates.length === 0 &&
    result.updates.length === 0 &&
    result.moves.length === 0 &&
    result.deletes.length === 0
  );
}
