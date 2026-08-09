/**
 * Block Parser
 *
 * Parses Roam API block data into ExistingBlock structures
 * and provides utilities for flattening block trees.
 */

import type { ExistingBlock, RoamApiBlock, NewBlock, BlockRef } from './types.js';
import { generateBlockUid, parseMarkdown, convertToRoamMarkdown } from '../markdown-utils.js';
import { isHiddenBlockString } from '../tools/helpers/hidden.js';

/**
 * Parse a raw Roam API block into an ExistingBlock structure.
 * Recursively processes children and sorts them by order.
 *
 * @param roamBlock - Raw block data from Roam API
 * @param parentUid - UID of the parent block (null for page-level blocks)
 * @returns Parsed ExistingBlock with normalized structure
 */
export function parseExistingBlock(
  roamBlock: RoamApiBlock,
  parentUid: string | null = null
): ExistingBlock {
  const childrenRaw = roamBlock[':block/children'] ?? [];
  const childrenSorted = [...childrenRaw].sort(
    (a, b) => (a[':block/order'] ?? 0) - (b[':block/order'] ?? 0)
  );

  const uid = roamBlock[':block/uid'] ?? '';
  const children = childrenSorted.map((c) => parseExistingBlock(c, uid));

  return {
    uid,
    text: roamBlock[':block/string'] ?? '',
    order: roamBlock[':block/order'] ?? 0,
    heading: roamBlock[':block/heading'] ?? null,
    children,
    parentUid,
  };
}

/**
 * Parse all top-level blocks from a Roam page into ExistingBlock structures.
 *
 * @param pageData - Raw page data from Roam API (with :block/children)
 * @returns Array of ExistingBlock for all top-level blocks
 */
export function parseExistingBlocks(pageData: RoamApiBlock): ExistingBlock[] {
  const childrenRaw = pageData[':block/children'] ?? [];
  const childrenSorted = [...childrenRaw].sort(
    (a, b) => (a[':block/order'] ?? 0) - (b[':block/order'] ?? 0)
  );

  return childrenSorted.map((c) => parseExistingBlock(c, null));
}

/**
 * Drop `#.rm-hide` / `#.rm-private` subtrees from a diff baseline.
 *
 * THE RULE THIS ENFORCES: **the baseline a diff deletes from must be the same
 * page the caller was allowed to read.**
 *
 * Every read path filters these subtrees out, so an agent composing replacement
 * markdown cannot include what it was never shown. The diff then compared that
 * markdown against the *unfiltered* page, found the hidden blocks unaccounted
 * for, and deleted them — turning "hide this from the AI" into "let the AI
 * delete this", with no undo. Pruning the baseline makes the two views agree:
 * a block that is invisible is also unmatched-against, so it is never a
 * deletion candidate.
 *
 * WHAT THIS DOES NOT PRESERVE: position. A surviving hidden block keeps its
 * original `:block/order`, while the new blocks are numbered from the markdown,
 * so a hidden block can end up sharing an order with a visible sibling and
 * settle either side of it. Ordering is a sort key, not content — and the
 * alternative, reserving slots for blocks the caller cannot see, would let
 * hidden content dictate visible layout. Content survives; exact position may
 * not.
 *
 * @param blocks - Parsed baseline, straight from `parseExistingBlocks`
 * @returns The same trees with hidden blocks and their descendants removed
 */
export function pruneHiddenExistingBlocks(blocks: ExistingBlock[]): ExistingBlock[] {
  const kept: ExistingBlock[] = [];
  for (const block of blocks) {
    // The whole subtree goes: a visible child of a hidden parent is still
    // content the caller never saw, so it is equally undeletable.
    if (isHiddenBlockString(block.text)) continue;
    kept.push({ ...block, children: pruneHiddenExistingBlocks(block.children) });
  }
  return kept;
}

/** How many blocks `pruneHiddenExistingBlocks` would remove, counting subtrees. */
export function countHiddenExistingBlocks(blocks: ExistingBlock[]): number {
  let count = 0;
  for (const block of blocks) {
    if (isHiddenBlockString(block.text)) {
      // The block plus everything under it, all of which is being protected.
      count += 1 + flattenExistingBlocks(block.children).length;
    } else {
      count += countHiddenExistingBlocks(block.children);
    }
  }
  return count;
}

/**
 * Flatten a tree of existing blocks into a single array.
 * Preserves parent-child relationships through parentUid property.
 *
 * @param blocks - Array of ExistingBlock trees
 * @returns Flat array of all blocks in depth-first order
 */
export function flattenExistingBlocks(blocks: ExistingBlock[]): ExistingBlock[] {
  const result: ExistingBlock[] = [];

  function flatten(block: ExistingBlock): void {
    result.push(block);
    for (const child of block.children) {
      flatten(child);
    }
  }

  for (const block of blocks) {
    flatten(block);
  }

  return result;
}

/**
 * Convert markdown content into NewBlock structures ready for diffing.
 *
 * @param markdown - GFM markdown content
 * @param pageUid - UID of the page (used as root parent)
 * @returns Array of NewBlock structures representing desired state
 */
export function markdownToBlocks(markdown: string, pageUid: string): NewBlock[] {
  // Parse markdown into nested structure
  const nodes = parseMarkdown(markdown);
  const blocks: NewBlock[] = [];

  // Track parent refs by level for nesting
  const parentRefByLevel: (BlockRef | null)[] = [null];

  interface MarkdownNode {
    content: string;
    level: number;
    heading_level?: number;
    children: MarkdownNode[];
  }

  /**
   * Recursively convert markdown nodes to NewBlock structures.
   */
  function processNode(
    node: MarkdownNode,
    parentRef: BlockRef | null,
    siblingIndex: number
  ): void {
    const blockUid = generateBlockUid();
    const ref: BlockRef = { blockUid };

    const newBlock: NewBlock = {
      ref,
      text: node.content,
      parentRef,
      order: siblingIndex,
      open: true,
      heading: node.heading_level ?? null,
    };

    blocks.push(newBlock);

    // Process children with this block as parent
    node.children.forEach((child, idx) => {
      processNode(child, ref, idx);
    });
  }

  // Process all root nodes
  nodes.forEach((node, idx) => {
    processNode(node, { blockUid: pageUid }, idx);
  });

  return blocks;
}

/**
 * Get the depth of a block in the tree (0 for root blocks).
 */
export function getBlockDepth(block: NewBlock, blocks: NewBlock[]): number {
  let depth = 0;
  let current = block;

  while (current.parentRef) {
    const parent = blocks.find((b) => b.ref.blockUid === current.parentRef?.blockUid);
    if (!parent || parent === current) break;
    depth++;
    current = parent;
  }

  return depth;
}
