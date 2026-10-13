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
    const { text, page_title_uid, case_sensitive = false, limit = -1, offset = 0, scope = 'blocks' } = this.params;

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
    let queryLimit = limit === -1 ? '' : `:limit ${limit}`;
    let queryOffset = offset === 0 ? '' : `:offset ${offset}`;
    let queryOrder = `:order ?page-edit-time asc ?block-uid asc`; // Sort by page edit time, then block UID


    let baseQueryWhereClauses = `
                    [?b :block/string ?block-str]
                    ${textSearchClause}
                    [?b :block/uid ?block-uid]
                    [?b :block/page ?p]
                    [?p :node/title ?page-title]
                    [?p :edit/time ?page-edit-time]
                    [(get-else $ ?b :create/time 0) ?block-create-time]
                    [(get-else $ ?b :edit/time 0) ?block-edit-time]`; // Fetch page edit time for sorting, block timestamps for sort/group

    if (targetPageUid) {
      queryStr = `[:find ?block-uid ?block-str ?page-title ?block-create-time ?block-edit-time
                    :in $ ?page-uid ${queryLimit} ${queryOffset} ${queryOrder}
                    :where
                    ${baseQueryWhereClauses}
                    [?p :block/uid ?page-uid]]`;
      queryParams = [targetPageUid];
    } else {
      queryStr = `[:find ?block-uid ?block-str ?page-title ?block-create-time ?block-edit-time
                    :in $ ${queryLimit} ${queryOffset} ${queryOrder}
                    :where
                    ${baseQueryWhereClauses}]`;
    }

    const rawResults = await q(this.graph, queryStr, queryParams) as [string, string, string?, number?, number?][];

    // Query to get total count without limit
    const baseCountWhere = baseQueryWhereClauses.replace(/\[\?p :edit\/time \?page-edit-time\]/, '');
    let countQueryStr: string;
    let countQueryParams: (string | number)[] = [];

    if (targetPageUid) {
      countQueryStr = `[:find (count ?b)
                            :in $ ?page-uid
                            :where
                            ${baseCountWhere}
                            [?p :block/uid ?page-uid]]`;
      countQueryParams = [targetPageUid];
    } else {
      countQueryStr = `[:find (count ?b)
                            :in $
                            :where
                            ${baseCountWhere}]`;
    }

    const totalCountResults = await q(this.graph, countQueryStr, countQueryParams) as number[][];
    const totalCount = totalCountResults[0] ? totalCountResults[0][0] : 0;

    // Resolve block references in content
    const resolvedResults = await this.resolveBlockRefs(rawResults);

    const searchDescription = `containing "${text}"`;
    const formattedResults = SearchUtils.formatSearchResults(resolvedResults, searchDescription, !targetPageUid);
    formattedResults.total_count = totalCount;
    return formattedResults;
  }

  /**
   * Search for page titles matching a namespace prefix.
   * Normalizes the search text to ensure trailing slash for prefix matching.
   */
  private async executePageTitleSearch(): Promise<SearchResult> {
    const { text, limit = -1, offset = 0 } = this.params;

    // Normalize namespace: ensure trailing slash for prefix matching
    const namespace = text.endsWith('/') ? text : `${text}/`;

    // Query for pages with titles starting with the namespace
    const queryLimit = limit === -1 ? '' : `:limit ${limit}`;
    const queryOffset = offset === 0 ? '' : `:offset ${offset}`;

    const queryStr = `[:find ?title ?uid
                      :in $ ${queryLimit} ${queryOffset}
                      :where
                      [?e :node/title ?title]
                      [?e :block/uid ?uid]
                      [(clojure.string/starts-with? ?title ${ednString(namespace)})]]`;

    const rawResults = await q(this.graph, queryStr, []) as [string, string][];

    // Get total count
    const countQueryStr = `[:find (count ?e)
                           :in $
                           :where
                           [?e :node/title ?title]
                           [(clojure.string/starts-with? ?title ${ednString(namespace)})]]`;
    const totalCountResults = await q(this.graph, countQueryStr, []) as number[][];
    const totalCount = totalCountResults[0] ? totalCountResults[0][0] : 0;

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
      total_count: totalCount
    };
  }
}
