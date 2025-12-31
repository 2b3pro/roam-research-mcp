/**
 * Block Matcher
 *
 * Matches new blocks to existing blocks using a three-phase strategy:
 * 1. Exact text match
 * 2. Normalized text match (removes list prefixes)
 * 3. Position-based fallback (conservative, only for small sets)
 */

import type { ExistingBlock, NewBlock } from './types.js';

/**
 * Normalize text for exact matching.
 * Trims whitespace only.
 */
export function normalizeText(text: string): string {
  return text.trim();
}

/**
 * Normalize text for fuzzy matching.
 * Removes list prefixes (1. , 2. , etc.) in addition to trimming.
 */
export function normalizeForMatching(text: string): string {
  return text.trim().replace(/^\d+\.\s+/, '');
}

/**
 * Match new blocks to existing blocks using a three-phase strategy.
 *
 * Phase 1: Exact text match
 * - Compare normalized text (trimmed whitespace)
 * - When multiple candidates exist, prefer the one closest to same position
 *
 * Phase 2: Normalized text match
 * - Remove list prefixes before matching
 * - Handles cases where markdown adds numbering that Roam doesn't have
 *
 * Phase 3: Position-based fallback
 * - Only used when ≤3 unmatched blocks remain on each side
 * - Conservative to avoid incorrect matches
 *
 * @param existing - Flat array of existing blocks
 * @param newBlocks - Array of new blocks to match
 * @returns Map of newUid -> existingUid for matched blocks
 */
export function matchBlocks(
  existing: ExistingBlock[],
  newBlocks: NewBlock[]
): Map<string, string> {
  const matches = new Map<string, string>(); // newUid -> existingUid
  const usedExisting = new Set<string>();

  // Build indices for efficient lookups
  const existingByText = new Map<string, ExistingBlock[]>();
  const existingByNormalized = new Map<string, ExistingBlock[]>();

  for (const eb of existing) {
    // Index by exact normalized text
    const normText = normalizeText(eb.text);
    if (!existingByText.has(normText)) {
      existingByText.set(normText, []);
    }
    existingByText.get(normText)!.push(eb);

    // Index by matching-normalized text (without list prefixes)
    const matchText = normalizeForMatching(eb.text);
    if (!existingByNormalized.has(matchText)) {
      existingByNormalized.set(matchText, []);
    }
    existingByNormalized.get(matchText)!.push(eb);
  }

  // Phase 1: Exact text matches
  newBlocks.forEach((newBlock, idx) => {
    const normText = normalizeText(newBlock.text);
    const candidates = (existingByText.get(normText) ?? []).filter(
      (e) => !usedExisting.has(e.uid)
    );

    if (candidates.length > 0) {
      // Prefer candidate closest to same position
      const best = candidates.reduce((a, b) =>
        Math.abs(a.order - idx) < Math.abs(b.order - idx) ? a : b
      );
      matches.set(newBlock.ref.blockUid, best.uid);
      usedExisting.add(best.uid);
    }
  });

  // Phase 2: Normalized text matches (without list prefixes)
  newBlocks.forEach((newBlock, idx) => {
    if (matches.has(newBlock.ref.blockUid)) return;

    const matchText = normalizeForMatching(newBlock.text);
    const candidates = (existingByNormalized.get(matchText) ?? []).filter(
      (e) => !usedExisting.has(e.uid)
    );

    if (candidates.length > 0) {
      const best = candidates.reduce((a, b) =>
        Math.abs(a.order - idx) < Math.abs(b.order - idx) ? a : b
      );
      matches.set(newBlock.ref.blockUid, best.uid);
      usedExisting.add(best.uid);
    }
  });

  // Phase 3: Position-based fallback (conservative)
  const unmatchedNew = newBlocks.filter((b) => !matches.has(b.ref.blockUid));
  const unmatchedExisting = existing.filter((e) => !usedExisting.has(e.uid));

  // Only use position matching when few blocks remain (avoid false matches)
  if (unmatchedNew.length <= 3 && unmatchedExisting.length <= 3) {
    const sortedExisting = [...unmatchedExisting].sort((a, b) => a.order - b.order);
    unmatchedNew.forEach((newBlock, idx) => {
      if (idx < sortedExisting.length) {
        const existBlock = sortedExisting[idx];
        matches.set(newBlock.ref.blockUid, existBlock.uid);
        usedExisting.add(existBlock.uid);
      }
    });
  }

  return matches;
}

/**
 * Group blocks by their parent UID for sibling analysis.
 */
export function groupByParent(blocks: ExistingBlock[]): Map<string | null, ExistingBlock[]> {
  const groups = new Map<string | null, ExistingBlock[]>();

  for (const block of blocks) {
    const parentKey = block.parentUid;
    if (!groups.has(parentKey)) {
      groups.set(parentKey, []);
    }
    groups.get(parentKey)!.push(block);
  }

  // Sort each group by order
  for (const [, siblings] of groups) {
    siblings.sort((a, b) => a.order - b.order);
  }

  return groups;
}
