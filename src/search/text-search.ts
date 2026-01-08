import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { BaseSearchHandler, SearchResult, TextSearchParams } from './types.js';
import { SearchUtils } from './utils.js';
import { resolveRefs } from '../tools/helpers/refs.js';

export class TextSearchHandler extends BaseSearchHandler {
  constructor(
    graph: Graph,
    private params: TextSearchParams
  ) {
    super(graph);
  }

  async execute(): Promise<SearchResult> {
    const { text, page_title_uid, case_sensitive = false, limit = -1, offset = 0 } = this.params;

    // Get target page UID if provided for scoped search
    let targetPageUid: string | undefined;
    if (page_title_uid) {
      targetPageUid = await SearchUtils.findPageByTitleOrUid(this.graph, page_title_uid);
    }

    const searchTerms: string[] = [];
    if (case_sensitive) {
      searchTerms.push(text);
    } else {
      searchTerms.push(text);
      // Add capitalized version (e.g., "Hypnosis")
      searchTerms.push(text.charAt(0).toUpperCase() + text.slice(1));
      // Add all caps version (e.g., "HYPNOSIS")
      searchTerms.push(text.toUpperCase());
      // Add all lowercase version (e.g., "hypnosis")
      searchTerms.push(text.toLowerCase());
    }

    const whereClauses = searchTerms.map(term => `[(clojure.string/includes? ?block-str "${term}")]`).join(' ');

    let queryStr: string;
    let queryParams: (string | number)[] = [];
    let queryLimit = limit === -1 ? '' : `:limit ${limit}`;
    let queryOffset = offset === 0 ? '' : `:offset ${offset}`;
    let queryOrder = `:order ?page-edit-time asc ?block-uid asc`; // Sort by page edit time, then block UID


    let baseQueryWhereClauses = `
                    [?b :block/string ?block-str]
                    (or ${whereClauses})
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
    const countQueryStr = `[:find (count ?b)
                            :in $
                            :where
                            ${baseQueryWhereClauses.replace(/\[\?p :edit\/time \?page-edit-time\]/, '')}]`; // Remove edit time for count query

    const totalCountResults = await q(this.graph, countQueryStr, queryParams) as number[][];
    const totalCount = totalCountResults[0] ? totalCountResults[0][0] : 0;

    // Resolve block references in content
    const resolvedResults = await Promise.all(
      rawResults.map(async ([uid, content, pageTitle, created, modified]) => {
        const resolvedContent = await resolveRefs(this.graph, content);
        return [uid, resolvedContent, pageTitle, created, modified] as [string, string, string?, number?, number?];
      })
    );

    const searchDescription = `containing "${text}"`;
    const formattedResults = SearchUtils.formatSearchResults(resolvedResults, searchDescription, !targetPageUid);
    formattedResults.total_count = totalCount;
    return formattedResults;
  }
}
