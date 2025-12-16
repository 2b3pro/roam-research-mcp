import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { BaseSearchHandler, SearchResult } from './types.js';
import { SearchUtils } from './utils.js';
import { resolveRefs } from '../tools/helpers/refs.js';

export interface HierarchySearchParams {
  parent_uid?: string;  // Search for children of this block
  child_uid?: string;   // Search for parents of this block
  page_title_uid?: string;
  max_depth?: number;   // How many levels deep to search (default: 1)
}

export class HierarchySearchHandler extends BaseSearchHandler {
  constructor(
    graph: Graph,
    private params: HierarchySearchParams
  ) {
    super(graph);
  }

  async execute(): Promise<SearchResult> {
    const { parent_uid, child_uid, page_title_uid, max_depth = 1 } = this.params;

    if (!parent_uid && !child_uid) {
      return {
        success: false,
        matches: [],
        message: 'Either parent_uid or child_uid must be provided'
      };
    }

    // Get target page UID if provided
    let targetPageUid: string | undefined;
    if (page_title_uid) {
      targetPageUid = await SearchUtils.findPageByTitleOrUid(this.graph, page_title_uid);
    }

    // Define ancestor rule for recursive traversal
    const ancestorRule = `[
      [ (ancestor ?child ?parent) 
          [?parent :block/children ?child] ]
      [ (ancestor ?child ?a) 
          [?parent :block/children ?child] 
          (ancestor ?parent ?a) ]
    ]`;

    let queryStr: string;
    let queryParams: any[];

    if (parent_uid) {
      // Search for all descendants using ancestor rule
      if (targetPageUid) {
        queryStr = `[:find ?block-uid ?block-str ?depth
                    :in $ % ?parent-uid ?page-uid
                    :where [?p :block/uid ?page-uid]
                           [?parent :block/uid ?parent-uid]
                           (ancestor ?b ?parent)
                           [?b :block/string ?block-str]
                           [?b :block/uid ?block-uid]
                           [?b :block/page ?p]
                           [(get-else $ ?b :block/path-length 1) ?depth]]`;
        queryParams = [ancestorRule, parent_uid, targetPageUid];
      } else {
        queryStr = `[:find ?block-uid ?block-str ?page-title ?depth
                    :in $ % ?parent-uid
                    :where [?parent :block/uid ?parent-uid]
                           (ancestor ?b ?parent)
                           [?b :block/string ?block-str]
                           [?b :block/uid ?block-uid]
                           [?b :block/page ?p]
                           [?p :node/title ?page-title]
                           [(get-else $ ?b :block/path-length 1) ?depth]]`;
        queryParams = [ancestorRule, parent_uid];
      }
    } else {
      // Search for ancestors using the same rule
      if (targetPageUid) {
        queryStr = `[:find ?block-uid ?block-str ?depth
                    :in $ % ?child-uid ?page-uid
                    :where [?p :block/uid ?page-uid]
                           [?child :block/uid ?child-uid]
                           (ancestor ?child ?b)
                           [?b :block/string ?block-str]
                           [?b :block/uid ?block-uid]
                           [?b :block/page ?p]
                           [(get-else $ ?b :block/path-length 1) ?depth]]`;
        queryParams = [ancestorRule, child_uid, targetPageUid];
      } else {
        queryStr = `[:find ?block-uid ?block-str ?page-title ?depth
                    :in $ % ?child-uid
                    :where [?child :block/uid ?child-uid]
                           (ancestor ?child ?b)
                           [?b :block/string ?block-str]
                           [?b :block/uid ?block-uid]
                           [?b :block/page ?p]
                           [?p :node/title ?page-title]
                           [(get-else $ ?b :block/path-length 1) ?depth]]`;
        queryParams = [ancestorRule, child_uid];
      }
    }

    const rawResults = await q(this.graph, queryStr, queryParams) as [string, string, string?, number?][];
    
    // Resolve block references and format results to include depth information
    const matches = await Promise.all(rawResults.map(async ([uid, content, pageTitle, depth]) => {
      const resolvedContent = await resolveRefs(this.graph, content);
      return {
        block_uid: uid,
        content: resolvedContent,
        depth: depth || 1,
        ...(pageTitle && { page_title: pageTitle })
      };
    }));

    const searchDescription = parent_uid
      ? `descendants of block ${parent_uid}`
      : `ancestors of block ${child_uid}`;

    return {
      success: true,
      matches,
      message: `Found ${matches.length} block(s) as ${searchDescription}`
    };
  }
}
