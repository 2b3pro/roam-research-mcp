import { Graph, q } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { RoamBlock } from '../../types/roam.js';

export class BlockRetrievalOperations {
  constructor(private graph: Graph) {}

  async fetchBlockWithChildren(block_uid_raw: string, depth: number = 4): Promise<RoamBlock | null> {
    if (!block_uid_raw) {
      throw new McpError(ErrorCode.InvalidRequest, 'block_uid is required.');
    }

    const block_uid = block_uid_raw.replace(/^\(\((.*)\)\)$/, '$1');

    const fetchChildren = async (parentUids: string[], currentDepth: number): Promise<Record<string, RoamBlock[]>> => {
      if (currentDepth >= depth || parentUids.length === 0) {
        return {};
      }

      const childrenQuery = `[:find ?parentUid ?childUid ?childString ?childOrder ?childHeading
                              :in $ [?parentUid ...]
                              :where [?parent :block/uid ?parentUid]
                                     [?child :block/parents ?parent]
                                     [?child :block/uid ?childUid]
                                     [?child :block/string ?childString]
                                     [?child :block/order ?childOrder]
                                     [(get-else $ ?child :block/heading 0) ?childHeading]]`;

      const childrenResults = await q(this.graph, childrenQuery, [parentUids]) as [string, string, string, number, number | null][];

      const childrenByParent: Record<string, RoamBlock[]> = {};
      const allChildUids: string[] = [];

      for (const [parentUid, childUid, childString, childOrder, childHeading] of childrenResults) {
        if (!childrenByParent[parentUid]) {
          childrenByParent[parentUid] = [];
        }
        childrenByParent[parentUid].push({
          uid: childUid,
          string: childString,
          order: childOrder,
          heading: childHeading || undefined,
          children: [],
        });
        allChildUids.push(childUid);
      }

      const grandChildren = await fetchChildren(allChildUids, currentDepth + 1);

      for (const parentUid in childrenByParent) {
        for (const child of childrenByParent[parentUid]) {
          child.children = grandChildren[child.uid] || [];
        }
        childrenByParent[parentUid].sort((a, b) => a.order - b.order);
      }

      return childrenByParent;
    };

    try {
      const rootBlockQuery = `[:find ?string ?order ?heading
                               :in $ ?blockUid
                               :where [?b :block/uid ?blockUid]
                                      [?b :block/string ?string]
                                      [?b :block/order ?order]
                                      [(get-else $ ?b :block/heading 0) ?heading]]`;
      const rootBlockResult = await q(this.graph, rootBlockQuery, [block_uid]) as [string, number, number | null] | null;

      if (!rootBlockResult) {
        return null;
      }

      const [rootString, rootOrder, rootHeading] = rootBlockResult;
      const childrenMap = await fetchChildren([block_uid], 0);

      return {
        uid: block_uid,
        string: rootString,
        order: rootOrder,
        heading: rootHeading || undefined,
        children: childrenMap[block_uid] || [],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch block with children: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
