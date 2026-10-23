import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { BaseSearchHandler, SearchResult, TextSearchParams } from './types.js';
import { SearchUtils } from './utils.js';
import { ednString } from '../shared/datalog.js';

export class TextSearchHandler extends BaseSearchHandler {
  constructor(
    graph: Graph,
    private params: TextSearchParams
  ) {
    super(graph);
  }

  async execute(): Promise<SearchResult> {
    const { text, page_title_uid, case_sensitive = false, scope = 'blocks' } = this.params;

    // Handle page_titles scope (namespace search)
    if (scope === 'page_titles') {
      return this.executePageTitleSearch();
    }

    // Get target page UID if provided for scoped search
    let targetPageUid: string | undefined;
    if (page_title_uid) {
      targetPageUid = await SearchUtils.findPageByTitleOrUid(this.graph, page_title_uid);
    }

    const textSearchClause = SearchUtils.buildTextSearchClause(text, '?block-str', case_sensitive);

    let queryStr: string;
    let queryParams: (string | number)[] = [];


    const baseQueryWhereClauses = `
                    [?b :block/string ?block-str]
                    ${textSearchClause}
                    [?b :block/uid ?block-uid]
                    [?b :block/page ?p]
                    [?p :node/title ?page-title]
                    [(get-else $ ?b :create/time 0) ?block-create-time]
                    [(get-else $ ?b :edit/time 0) ?block-edit-time]`; // Block timestamps for CLI sort/group

    if (targetPageUid) {
      queryStr = `[:find ?block-uid ?block-str ?page-title ?block-create-time ?block-edit-time
                    :in $ ?page-uid
                    :where
                    ${baseQueryWhereClauses}
                    [?p :block/uid ?page-uid]]`;
      queryParams = [targetPageUid];
    } else {
      queryStr = `[:find ?block-uid ?block-str ?page-title ?block-create-time ?block-edit-time
                    :in $
                    :where
                    ${baseQueryWhereClauses}]`;
    }

    const rawResults = await q(this.graph, queryStr, queryParams) as [string, string, string?, number?, number?][];

    // Visibility filtering and pagination happen in SearchOperations, before
    // reference expansion. A separate count query would repeat this scan.
    const formattedResults = SearchUtils.formatSearchResults(rawResults, `containing "${text}"`, !targetPageUid);
    return formattedResults;
  }

  /**
   * Search for page titles matching a namespace prefix.
   * Normalizes the search text to ensure trailing slash for prefix matching.
   */
  private async executePageTitleSearch(): Promise<SearchResult> {
    const { text } = this.params;

    // Normalize namespace: ensure trailing slash for prefix matching
    const namespace = text.endsWith('/') ? text : `${text}/`;

    // Query for pages with titles starting with the namespace

    const queryStr = `[:find ?title ?uid
                      :in $
                      :where
                      [?e :node/title ?title]
                      [?e :block/uid ?uid]
                      [(clojure.string/starts-with? ?title ${ednString(namespace)})]]`;

    const rawResults = await q(this.graph, queryStr, []) as [string, string][];

    // Format results: page UID as block_uid, title as content
    const matches = rawResults.map(([title, uid]) => ({
      block_uid: uid,
      content: title,
      page_title: title
    }));

    // Sort alphabetically by title
    matches.sort((a, b) => a.content.localeCompare(b.content));

    return {
      success: true,
      matches,
      message: `Found ${matches.length} page(s) with namespace "${namespace}"`,
      total_count: matches.length
    };
  }
}
