import { Graph, q } from '@roam-research/roam-api-sdk';
import { RoamBlock } from '../../types/roam.js';

const childrenQuery = `[:find ?parentUid ?childUid ?childString ?childOrder ?childHeading
                        :in $ [?parentUid ...]
                        :where [?parent :block/uid ?parentUid]
                               [?parent :block/children ?child]
                               [?child :block/uid ?childUid]
                               [?child :block/string ?childString]
                               [?child :block/order ?childOrder]
                               [(get-else $ ?child :block/heading 0) ?childHeading]]`;

/**
 * Recursively fetch children for a set of parent UIDs up to maxDepth levels deep.
 * Returns a map of parent UID → sorted array of child RoamBlocks (with their children attached).
 */
export async function fetchChildrenByDepth(
  graph: Graph,
  parentUids: string[],
  maxDepth: number,
  currentDepth: number = 0
): Promise<Record<string, RoamBlock[]>> {
  if (currentDepth >= maxDepth || parentUids.length === 0) return {};

  const results = await q(graph, childrenQuery, [parentUids]) as [string, string, string, number, number | null][];
  if (!results || results.length === 0) return {};

  const childrenByParent: Record<string, RoamBlock[]> = {};
  const allChildUids: string[] = [];

  for (const [parentUid, childUid, childString, childOrder, childHeading] of results) {
    if (!childrenByParent[parentUid]) childrenByParent[parentUid] = [];
    childrenByParent[parentUid].push({
      uid: childUid,
      string: childString,
      order: childOrder,
      heading: childHeading || undefined,
      children: [],
    });
    allChildUids.push(childUid);
  }

  const grandChildren = await fetchChildrenByDepth(graph, allChildUids, maxDepth, currentDepth + 1);

  for (const parentUid in childrenByParent) {
    for (const child of childrenByParent[parentUid]) {
      child.children = grandChildren[child.uid] || [];
    }
    childrenByParent[parentUid].sort((a, b) => a.order - b.order);
  }

  return childrenByParent;
}
