/**
 * Diff Computation
 *
 * Computes the minimal set of batch actions needed to transform
 * existing blocks into the desired new block structure.
 */

import type { ExistingBlock, NewBlock, DiffResult } from './types.js';
import type { RoamBatchAction } from '../types/roam.js';
import { flattenExistingBlocks } from './parser.js';
import { matchBlocks, normalizeText } from './matcher.js';

/**
 * Compute the diff between existing blocks and desired new blocks.
 *
 * This function:
 * 1. Matches new blocks to existing blocks by content similarity
 * 2. For matched blocks: generates update/move actions as needed
 * 3. For unmatched new blocks: generates create actions
 * 4. For unmatched existing blocks: generates delete actions
 *
 * @param existing - Array of existing block trees
 * @param newBlocks - Flat array of new blocks (desired state)
 * @param parentUid - UID of the parent page/block
 * @returns DiffResult with categorized actions
 */
export function diffBlockTrees(
  existing: ExistingBlock[],
  newBlocks: NewBlock[],
  parentUid: string
): DiffResult {
  const result: DiffResult = {
    creates: [],
    updates: [],
    moves: [],
    deletes: [],
    preservedUids: new Set(),
  };

  // Flatten existing blocks for matching
  const existingFlat = flattenExistingBlocks(existing);

  // Step 1: Match blocks by content
  const matches = matchBlocks(existingFlat, newBlocks);

  // Build uid -> ExistingBlock mapping
  const existingByUid = new Map(existingFlat.map((eb) => [eb.uid, eb]));

  /**
   * Resolve the desired parent UID for a new block.
   * If the parent was matched to an existing block, use that UID.
   */
  function desiredParentUid(newBlock: NewBlock): string {
    if (!newBlock.parentRef) return parentUid;
    const parentNewUid = newBlock.parentRef.blockUid;
    if (parentNewUid === parentUid) return parentUid;
    // If parent is matched, target the existing parent UID
    return matches.get(parentNewUid) ?? parentNewUid;
  }

  // Build desired structure: map each new block to its desired parent
  // and group siblings by their desired parent
  const newUidToDesiredParent = new Map<string, string>();
  const siblingsByDesiredParent = new Map<string, string[]>();

  for (const newBlock of newBlocks) {
    const newUid = newBlock.ref.blockUid;
    const targetUid = matches.get(newUid) ?? newUid;
    const dParent = desiredParentUid(newBlock);

    newUidToDesiredParent.set(newUid, dParent);

    if (!siblingsByDesiredParent.has(dParent)) {
      siblingsByDesiredParent.set(dParent, []);
    }
    siblingsByDesiredParent.get(dParent)!.push(targetUid);
  }

  // Step 2: Process each new block
  for (const newBlock of newBlocks) {
    const newUid = newBlock.ref.blockUid;

    if (matches.has(newUid)) {
      // Block matched to an existing block
      const existUid = matches.get(newUid)!;
      const existBlock = existingByUid.get(existUid)!;
      const currentParent = existBlock.parentUid ?? parentUid;
      const dParent = newUidToDesiredParent.get(newUid)!;

      result.preservedUids.add(existUid);

      // Check for text/heading changes -> update-block
      let needsUpdate = false;
      const updateAction: RoamBatchAction = {
        action: 'update-block',
        block: { uid: existUid },
      };

      if (normalizeText(newBlock.text) !== normalizeText(existBlock.text)) {
        (updateAction as any).block.string = newBlock.text;
        needsUpdate = true;
      }

      if (newBlock.heading !== existBlock.heading) {
        if (newBlock.heading !== null) {
          (updateAction as any).block.heading = newBlock.heading;
          needsUpdate = true;
        } else if (existBlock.heading !== null) {
          // Remove heading by setting to 0
          (updateAction as any).block.heading = 0;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        result.updates.push(updateAction);
      }

      // Check for parent/order changes -> move-block
      const desiredSiblings = siblingsByDesiredParent.get(dParent) ?? [];
      const desiredOrder = desiredSiblings.indexOf(existUid);

      if (currentParent !== dParent || existBlock.order !== desiredOrder) {
        result.moves.push({
          action: 'move-block',
          block: { uid: existUid },
          location: { 'parent-uid': dParent, order: desiredOrder },
        } as RoamBatchAction);
      }
    } else {
      // No match -> create-block
      const dParent = newUidToDesiredParent.get(newUid)!;
      const desiredSiblings = siblingsByDesiredParent.get(dParent) ?? [];
      const desiredOrder = desiredSiblings.indexOf(newUid);

      const createAction: RoamBatchAction = {
        action: 'create-block',
        location: {
          'parent-uid': dParent,
          order: desiredOrder >= 0 ? desiredOrder : 'last',
        },
        block: {
          uid: newBlock.ref.blockUid,
          string: newBlock.text,
        },
      };

      if (newBlock.heading !== null) {
        (createAction as any).block.heading = newBlock.heading;
      }
      if (newBlock.open !== undefined) {
        (createAction as any).block.open = newBlock.open;
      }

      result.creates.push(createAction);
    }
  }

  // Step 3: Find unmatched existing blocks -> delete
  const matchedExistingUids = new Set(matches.values());
  for (const existBlock of existingFlat) {
    if (!matchedExistingUids.has(existBlock.uid)) {
      result.deletes.push({
        action: 'delete-block',
        block: { uid: existBlock.uid },
      } as RoamBatchAction);
    }
  }

  return result;
}

/**
 * Diff blocks at a specific level (for hierarchical diffing).
 * Used internally for recursive tree comparison.
 */
export function diffBlockLevel(
  existing: ExistingBlock[],
  newBlocks: NewBlock[],
  parentUid: string
): DiffResult {
  // Filter to only blocks at this level (direct children of parentUid)
  const existingAtLevel = existing.filter((e) => e.parentUid === parentUid || e.parentUid === null);
  const newAtLevel = newBlocks.filter(
    (n) => n.parentRef?.blockUid === parentUid || (!n.parentRef && parentUid === parentUid)
  );

  return diffBlockTrees(existingAtLevel, newAtLevel, parentUid);
}
