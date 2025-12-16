import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { BaseSearchHandler, SearchResult } from './types.js';
import { SearchUtils } from './utils.js';
import { resolveRefs } from '../tools/helpers/refs.js';

export interface BlockRefSearchParams {
  block_uid?: string;
  page_title_uid?: string;
}

export class BlockRefSearchHandler extends BaseSearchHandler {
  constructor(
    graph: Graph,
    private params: BlockRefSearchParams
  ) {
    super(graph);
  }

  async execute(): Promise<SearchResult> {
    const { block_uid, page_title_uid } = this.params;

    // Get target page UID if provided
    let targetPageUid: string | undefined;
    if (page_title_uid) {
      targetPageUid = await SearchUtils.findPageByTitleOrUid(this.graph, page_title_uid);
    }

    // Build query based on whether we're searching for references to a specific block
    // or all block references within a page/graph
    let queryStr: string;
    let queryParams: any[];

    if (block_uid) {
      // Search for references to a specific block
      if (targetPageUid) {
        queryStr = `[:find ?block-uid ?block-str
                    :in $ ?ref-uid ?page-uid
                    :where [?p :block/uid ?page-uid]
                           [?b :block/page ?p]
                           [?b :block/string ?block-str]
                           [?b :block/uid ?block-uid]
                           [(clojure.string/includes? ?block-str ?ref-uid)]]`;
        queryParams = [`((${block_uid}))`, targetPageUid];
      } else {
        queryStr = `[:find ?block-uid ?block-str ?page-title
                    :in $ ?ref-uid
                    :where [?b :block/string ?block-str]
                           [?b :block/uid ?block-uid]
                           [?b :block/page ?p]
                           [?p :node/title ?page-title]
                           [(clojure.string/includes? ?block-str ?ref-uid)]]`;
        queryParams = [`((${block_uid}))`];
      }
    } else {
      // Search for any block references
      if (targetPageUid) {
        queryStr = `[:find ?block-uid ?block-str
                    :in $ ?page-uid
                    :where [?p :block/uid ?page-uid]
                           [?b :block/page ?p]
                           [?b :block/string ?block-str]
                           [?b :block/uid ?block-uid]
                           [(re-find #"\\(\\([^)]+\\)\\)" ?block-str)]]`;
        queryParams = [targetPageUid];
      } else {
        queryStr = `[:find ?block-uid ?block-str ?page-title
                    :where [?b :block/string ?block-str]
                           [?b :block/uid ?block-uid]
                           [?b :block/page ?p]
                           [?p :node/title ?page-title]
                           [(re-find #"\\(\\([^)]+\\)\\)" ?block-str)]]`;
        queryParams = [];
      }
    }

    const rawResults = await q(this.graph, queryStr, queryParams) as [string, string, string?][];
    
    // Resolve block references in content
    const resolvedResults = await Promise.all(
      rawResults.map(async ([uid, content, pageTitle]) => {
        const resolvedContent = await resolveRefs(this.graph, content);
        return [uid, resolvedContent, pageTitle] as [string, string, string?];
      })
    );
    
    const searchDescription = block_uid 
      ? `referencing block ((${block_uid}))`
      : 'containing block references';
      
    return SearchUtils.formatSearchResults(resolvedResults, searchDescription, !targetPageUid);
  }
}
