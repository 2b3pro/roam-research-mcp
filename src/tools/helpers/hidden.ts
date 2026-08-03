/**
 * Honouring Roam's "hide from AI" tags.
 *
 * Roam has an official convention for keeping content out of an AI's view:
 * a block tagged `#.rm-hide` or `#.rm-private` — and everything nested under
 * it — is omitted from the content AI tools return. `.rm-private` is Roam's
 * existing "hidden from other users" tag; `.rm-hide` hides from the AI
 * specifically.
 *
 * THIS IS A CONVENIENCE FILTER, NOT A SECURITY GUARANTEE. It is applied only
 * to the content-read paths. `roam_datomic_query` reads the database directly
 * and deliberately does NOT apply it — a capable agent can still surface
 * hidden blocks through raw Datalog. Treat these tags as "keep it out of the
 * AI's way", not "keep it secret".
 */

import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';

/** The tags that mark a subtree as hidden. */
export const HIDE_TAGS = ['.rm-hide', '.rm-private'] as const;

/**
 * Matches the three ways Roam can reference a hide tag:
 *   #.rm-hide        bare hashtag
 *   #[[.rm-hide]]    bracketed hashtag
 *   [[.rm-hide]]     plain page link
 *
 * The bare-hashtag branch is guarded by `(?![\w-])` so `#.rm-hidden` and
 * `#.rm-highlight` do not match.
 *
 * Case-insensitive on purpose. Over-hiding is the safe failure direction for a
 * privacy filter: if someone writes `#.RM-Hide` they plainly meant to hide it,
 * and revealing content the user tried to conceal is the worse error.
 */
const HIDE_TAG_PATTERN = new RegExp(
  `(?:#\\[\\[|\\[\\[)\\.rm-(?:hide|private)\\]\\]|#\\.rm-(?:hide|private)(?![\\w-])`,
  'i'
);

/** Does this block's text carry a hide tag? */
export function isHiddenBlockString(text: string | null | undefined): boolean {
  if (!text) return false;
  return HIDE_TAG_PATTERN.test(text);
}

/** The minimal shape this module needs: text plus optional children. */
interface PrunableBlock {
  string?: string | null;
  children?: PrunableBlock[];
}

/**
 * Drop every hidden block, along with its entire subtree, from a block tree.
 *
 * Returns new arrays rather than mutating in place — callers hold references
 * into these trees (block maps, UID lookups) and splicing under them is how
 * you get half-filtered output.
 */
export function pruneHiddenBlocks<T extends PrunableBlock>(blocks: T[]): T[] {
  const kept: T[] = [];
  for (const block of blocks) {
    if (isHiddenBlockString(block.string)) continue;
    kept.push(
      Array.isArray(block.children) && block.children.length > 0
        ? { ...block, children: pruneHiddenBlocks(block.children) }
        : block
    );
  }
  return kept;
}

/**
 * Filter a flat list of search matches against a set of hidden UIDs.
 *
 * Flat results carry no ancestry, so the caller must supply the closure of
 * hidden UIDs (hidden blocks *and* their descendants) — see
 * `collectHiddenUids`.
 */
export function filterHiddenMatches<T extends { block_uid?: string; content?: string }>(
  matches: T[],
  hiddenUids: ReadonlySet<string>
): T[] {
  return matches.filter((m) => {
    if (m.block_uid && hiddenUids.has(m.block_uid)) return false;
    // Belt and braces: a match whose own text carries the tag is hidden even if
    // the UID closure missed it (stale cache, query cap).
    return !isHiddenBlockString(m.content);
  });
}

// ---------------------------------------------------------------------------
// The hidden-UID closure (hidden blocks + everything nested under them)
// ---------------------------------------------------------------------------

/**
 * Cached per Graph instance. A WeakMap so a retired graph connection doesn't
 * pin its UID set in memory.
 *
 * The TTL is a deliberate trade-off: recomputing on every search would add two
 * round trips to each call, while caching means a block tagged just now stays
 * visible for up to TTL_MS. Short enough to be unsurprising, long enough that a
 * burst of searches costs one lookup.
 */
const hiddenUidCache = new WeakMap<Graph, { at: number; uids: Set<string> }>();
const TTL_MS = 30_000;

/** Test seam — drop the memoised closure so a test can observe a fresh query. */
export function clearHiddenUidCache(graph: Graph): void {
  hiddenUidCache.delete(graph);
}

/**
 * Every UID that should be withheld: the tagged blocks themselves plus all of
 * their descendants.
 *
 * Two queries rather than one, and no `:in` bindings, so nothing depends on how
 * the API wrapper marshals query inputs:
 *
 *   1. candidate roots — a broad `includes?` on the tag text, then refined in JS
 *      with the precise pattern so `#.rm-hidden` and `#.rm-highlight` don't
 *      drag their subtrees into the closure.
 *   2. (root text, descendant uid) pairs — refined against the same predicate,
 *      so a descendant is only withheld when its ancestor is genuinely tagged.
 *
 * Uses Roam's materialised `:block/parents` rather than a recursive ancestor
 * rule: it covers every level in one clause and is far cheaper.
 *
 * On query failure this returns an EMPTY set rather than throwing. A filter
 * that can take down every read path is worse than one that occasionally lets
 * content through — and these tags are explicitly not a security boundary.
 */
export async function collectHiddenUids(graph: Graph): Promise<ReadonlySet<string>> {
  const cached = hiddenUidCache.get(graph);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.uids;

  const uids = new Set<string>();
  try {
    const rootsQuery = `[:find ?uid ?s
                         :where [?h :block/string ?s]
                                (or [(clojure.string/includes? ?s ".rm-hide")]
                                    [(clojure.string/includes? ?s ".rm-private")])
                                [?h :block/uid ?uid]]`;
    const roots = (await q(graph, rootsQuery, [])) as unknown as [string, string][] | null;
    for (const [uid, text] of roots ?? []) {
      if (isHiddenBlockString(text)) uids.add(uid);
    }

    // Only worth the second round trip if something is actually tagged.
    if (uids.size > 0) {
      const descQuery = `[:find ?hs ?uid
                          :where [?h :block/string ?hs]
                                 (or [(clojure.string/includes? ?hs ".rm-hide")]
                                     [(clojure.string/includes? ?hs ".rm-private")])
                                 [?b :block/parents ?h]
                                 [?b :block/uid ?uid]]`;
      const pairs = (await q(graph, descQuery, [])) as unknown as [string, string][] | null;
      for (const [rootText, uid] of pairs ?? []) {
        if (isHiddenBlockString(rootText)) uids.add(uid);
      }
    }
  } catch {
    // Fall through with whatever we collected; see the note above.
  }

  hiddenUidCache.set(graph, { at: Date.now(), uids });
  return uids;
}
