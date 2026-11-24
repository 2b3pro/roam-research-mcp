/**
 * Roam's block versions.
 *
 * Giving a block a new version does not edit it. The old text stays in the
 * graph as a block of its own, with its own UID and its own children, and a
 * container entity lists every version of the block under `:vc/blocks`.
 *
 * A superseded version is taken out of its parent's `:block/children`, and
 * that is the only thing that marks it: it keeps `:block/string`,
 * `:block/page`, `:block/parents`, `:block/refs` and its timestamps. So a read
 * that walks `:block/children` (every page read) shows the version in use and
 * nothing else, while a query that matches blocks by attribute (every search)
 * matches the old text too, and the blocks nested under it, as if they were
 * live. A superseded `{{[[TODO]]}}` comes back as an open task.
 *
 * This module is how the content-read paths tell the two apart. Like the hide
 * filter beside it, it is not applied to `roam_datomic_query`, which reads the
 * database as it is.
 *
 * Observed on a live graph on 2026-11-24; Roam does not document the model.
 */

import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { isHiddenBlockString } from './hidden.js';

/** One version of a block, as `roam_fetch_block` reports it. */
export interface BlockVersion {
  uid: string;
  string: string;
  /** True for the version in use: the one a page read shows. */
  active: boolean;
}

/** Same trade-off, and the same 30 seconds, as the hidden-UID closure. */
const supersededUidCache = new WeakMap<Graph, { at: number; uids: Set<string> }>();
const TTL_MS = 30_000;

/** Test seam: drop the memoised set so a test can observe a fresh query. */
export function clearSupersededUidCache(graph: Graph): void {
  supersededUidCache.delete(graph);
}

/**
 * Every UID a search should leave out because it belongs to a version no
 * longer in use: the superseded versions themselves and everything nested
 * under them.
 *
 * A version is superseded when it is in a `:vc/blocks` set and in nobody's
 * `:block/children`. Its descendants are found through `:block/parents`, which
 * Roam keeps for every level, so one clause covers the whole subtree.
 *
 * Returns an EMPTY set when the query fails, as `collectHiddenUids` does: a
 * filter that takes every search down with it is worse than one that lets an
 * old version through.
 */
export async function collectSupersededUids(graph: Graph): Promise<ReadonlySet<string>> {
  const cached = supersededUidCache.get(graph);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.uids;

  const uids = new Set<string>();
  try {
    const versions = (await q(graph, `[:find ?uid
                                       :where [?vc :vc/blocks ?v]
                                              (not [?p :block/children ?v])
                                              [?v :block/uid ?uid]]`, [])) as unknown as [string][] | null;
    for (const [uid] of versions ?? []) uids.add(uid);

    // A graph that has never versioned a block stops here, one query in.
    if (uids.size > 0) {
      const nested = (await q(graph, `[:find ?uid
                                       :where [?vc :vc/blocks ?v]
                                              (not [?p :block/children ?v])
                                              [?d :block/parents ?v]
                                              [?d :block/uid ?uid]]`, [])) as unknown as [string][] | null;
      for (const [uid] of nested ?? []) uids.add(uid);
    }
  } catch {
    // Fall through with whatever was collected; see the note above.
  }

  supersededUidCache.set(graph, { at: Date.now(), uids });
  return uids;
}

/** Drop flat search matches that belong to a superseded version. */
export function filterSupersededMatches<T extends { block_uid?: string }>(
  matches: T[],
  supersededUids: ReadonlySet<string>
): T[] {
  if (supersededUids.size === 0) return matches;
  return matches.filter((m) => !m.block_uid || !supersededUids.has(m.block_uid));
}

/**
 * The versions of each of these blocks, oldest first, for the blocks that
 * have more than one.
 *
 * Asked by UID and never cached: this answers "which version is in use" for a
 * block someone is about to read or edit, where a 30-second-old answer could
 * name the wrong one. A block with no versions costs the first query only.
 *
 * A version the user hid (`#.rm-hide` / `#.rm-private`, on it or above it) is
 * left out, and a block left with a single visible version reports none, so
 * the list never hints at what was withheld.
 */
export async function fetchBlockVersions(
  graph: Graph,
  uids: string[],
  hidden: ReadonlySet<string>
): Promise<Map<string, BlockVersion[]>> {
  const result = new Map<string, BlockVersion[]>();
  if (uids.length === 0) return result;

  const rows = (await q(graph, `[:find ?rootUid ?versionUid ?string ?created
                                 :in $ [?rootUid ...]
                                 :where [?root :block/uid ?rootUid]
                                        [?vc :vc/blocks ?root]
                                        [?vc :vc/blocks ?v]
                                        [?v :block/uid ?versionUid]
                                        [?v :block/string ?string]
                                        [(get-else $ ?v :create/time 0) ?created]]`,
    [[...new Set(uids)]])) as unknown as [string, string, string, number][] | null;
  if (!rows || rows.length === 0) return result;

  const live = new Set(((await q(graph, `[:find ?versionUid
                                          :in $ [?versionUid ...]
                                          :where [?v :block/uid ?versionUid]
                                                 [?p :block/children ?v]]`,
    [[...new Set(rows.map(([, versionUid]) => versionUid))]])) as unknown as [string][] | null ?? [])
    .map(([uid]) => uid));

  const byRoot = new Map<string, Array<BlockVersion & { created: number }>>();
  for (const [rootUid, uid, string, created] of rows) {
    if (hidden.has(uid) || isHiddenBlockString(string)) continue;
    if (!byRoot.has(rootUid)) byRoot.set(rootUid, []);
    byRoot.get(rootUid)!.push({ uid, string, active: live.has(uid), created });
  }

  for (const [rootUid, versions] of byRoot) {
    if (versions.length < 2) continue;
    versions.sort((a, b) => a.created - b.created || a.uid.localeCompare(b.uid));
    result.set(rootUid, versions.map(({ uid, string, active }) => ({ uid, string, active })));
  }
  return result;
}
