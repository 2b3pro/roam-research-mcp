import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { BaseSearchHandler, TagSearchParams, SearchResult } from './types.js';
import { SearchUtils } from './utils.js';

export class TagSearchHandler extends BaseSearchHandler {
  constructor(
    graph: Graph,
    private params: TagSearchParams
  ) {
    super(graph);
  }

  async execute(): Promise<SearchResult> {
    const { primary_tag, page_title_uid, near_tag, exclude_tag } = this.params;

    // Get target page UID if provided for scoped search
    let targetPageUid: string | undefined;
    if (page_title_uid) {
      targetPageUid = await SearchUtils.findPageByTitleOrUid(this.graph, page_title_uid);
    }

    // Build query to find blocks referencing the page
    const queryStr = `[:find ?block-uid ?block-str ?page-title
                      :in $ ?title
                      :where 
                      [?ref-page :node/title ?title-match]
                      [(clojure.string/lower-case ?title-match) ?lower-title]
                      [(clojure.string/lower-case ?title) ?search-title]
                      [(= ?lower-title ?search-title)]
                      [?b :block/refs ?ref-page]
                      [?b :block/string ?block-str]
                      [?b :block/uid ?block-uid]
                      [?b :block/page ?p]
                      [?p :node/title ?page-title]]`;
    const queryParams = [primary_tag];

    const results = await q(this.graph, queryStr, queryParams) as [string, string, string?][];
    
    const searchDescription = `referencing "${primary_tag}"`;
    return SearchUtils.formatSearchResults(results, searchDescription, !targetPageUid);
  }
}
