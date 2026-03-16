import { Graph, q } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { RoamBlock, RoamAncestor, RoamBlockWithAncestors } from '../../types/roam.js';
import { resolveBlockRefs } from '../helpers/refs.js';

export class BlockRetrievalOperations {
  constructor(private graph: Graph) { }

  async fetchBlock(block_uid_raw: string, depth: number = 4, include_ancestors: boolean = false): Promise<RoamBlockWithAncestors | null> {
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
                                     [?parent :block/children ?child]
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
      const rootBlockResults = await q(this.graph, rootBlockQuery, [block_uid]) as [string, number, number | null][];

      if (!rootBlockResults || rootBlockResults.length === 0) {
        return null;
      }

      const [rootString, rootOrder, rootHeading] = rootBlockResults[0];
      const childrenMap = await fetchChildren([block_uid], 0);

      const rootBlock: RoamBlockWithAncestors = {
        uid: block_uid,
        string: rootString,
        order: rootOrder,
        heading: rootHeading || undefined,
        children: childrenMap[block_uid] || [],
      };

      // Fetch ancestors if requested
      if (include_ancestors) {
        const ancestorQuery = `[:find (pull ?b [:block/uid :block/string
                                                {:block/parents [:block/uid :block/string :node/title]}])
                                :where [?b :block/uid "${block_uid}"]]`;
        const ancestorResults = await q(this.graph, ancestorQuery, []) as any[];

        if (ancestorResults && ancestorResults.length > 0) {
          const blockData = ancestorResults[0][0] || ancestorResults[0];
          const parents = blockData[':block/parents'] || blockData.parents || [];

          const ancestors: RoamAncestor[] = [];
          for (const parent of parents) {
            const uid = parent[':block/uid'] || parent.uid;
            const str = parent[':block/string'] || parent.string;
            const title = parent[':node/title'] || parent.title;

            if (title) {
              ancestors.push({ uid, title, is_page: true, depth: 0 });
            } else {
              ancestors.push({ uid, string: str, depth: -1 }); // depth computed below
            }
          }

          // Compute depths: page root is 0, work backward
          // The parents array from Roam is unordered, so we need to establish order.
          // Strategy: the page (is_page=true) is depth 0. Build the parent chain
          // by querying direct parent relationships.
          if (ancestors.length > 1) {
            // Query to get direct parent mapping for ordering
            const parentUids = ancestors.map(a => a.uid);
            const orderQuery = `[:find ?childUid ?parentUid
                                 :in $ [?childUid ...]
                                 :where [?c :block/uid ?childUid]
                                        [?c :block/parents ?p]
                                        [?p :block/uid ?parentUid]
                                        [?p :block/children ?c]]`;
            const orderResults = await q(this.graph, orderQuery, [[block_uid, ...parentUids]]) as [string, string][];

            // Build child→parent map
            const childToParent: Record<string, string> = {};
            for (const [childUid, parentUid] of orderResults) {
              childToParent[childUid] = parentUid;
            }

            // Walk from target block up to page root to determine order and depth
            const orderedAncestors: RoamAncestor[] = [];
            let current = block_uid;
            let depthCounter = ancestors.length; // start high, count down

            while (childToParent[current]) {
              const parentUid = childToParent[current];
              const ancestor = ancestors.find(a => a.uid === parentUid);
              if (ancestor) {
                orderedAncestors.push(ancestor);
              }
              current = parentUid;
            }

            // Assign depths: first ancestor (direct parent) gets highest depth, page root gets 0
            for (let i = 0; i < orderedAncestors.length; i++) {
              orderedAncestors[i].depth = orderedAncestors.length - i;
            }
            // Page root should be depth 0
            const pageRoot = orderedAncestors.find(a => a.is_page);
            if (pageRoot) pageRoot.depth = 0;

            rootBlock.ancestors = orderedAncestors;
          } else {
            // Single ancestor = the page itself
            ancestors.forEach(a => { if (a.depth === -1) a.depth = 1; });
            rootBlock.ancestors = ancestors;
          }

          // Set page_title from the page ancestor
          const page = (rootBlock.ancestors || ancestors).find(a => a.is_page);
          if (page?.title) {
            rootBlock.page_title = page.title;
          }
        }
      }

      // Gather all blocks in the tree to scan for references
      const allBlocks: RoamBlock[] = [];
      const traverse = (b: RoamBlock) => {
        allBlocks.push(b);
        b.children.forEach(traverse);
      };
      traverse(rootBlock);

      // Resolve references (max depth 2)
      await resolveBlockRefs(this.graph, allBlocks, 2);

      return rootBlock;
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch block: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /** @deprecated Use fetchBlock() instead */
  async fetchBlockWithChildren(block_uid: string, depth?: number): Promise<RoamBlock | null> {
    return this.fetchBlock(block_uid, depth);
  }
}
