import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { BaseSearchHandler, SearchResult } from './types.js';
import { SearchUtils } from './utils.js';

export interface StatusSearchParams {
  status: 'TODO' | 'DONE';
  page_title_uid?: string;
}

export class StatusSearchHandler extends BaseSearchHandler {
  constructor(
    graph: Graph,
    private params: StatusSearchParams
  ) {
    super(graph);
  }

  async execute(): Promise<SearchResult> {
    const { status, page_title_uid } = this.params;

    // Get target page UID if provided
    let targetPageUid: string | undefined;
    if (page_title_uid) {
      targetPageUid = await SearchUtils.findPageByTitleOrUid(this.graph, page_title_uid);
    }

    // Build query based on whether we're searching in a specific page
    let queryStr: string;
    let queryParams: any[];

    // Match both formats: {{[[TODO]]}} does not contain "{{TODO", so each needs its own marker
    const [bracketed, bare] = SearchUtils.statusMarkers(status);
    if (targetPageUid) {
      queryStr = `[:find ?block-uid ?block-str ?page-title ?block-create-time ?block-edit-time
                  :in $ ?bracketed ?bare ?page-uid
                  :where [?p :block/uid ?page-uid]
                         [?p :node/title ?page-title]
                         [?b :block/page ?p]
                         [?b :block/string ?block-str]
                         [?b :block/uid ?block-uid]
                         (or [(clojure.string/includes? ?block-str ?bracketed)]
                             [(clojure.string/includes? ?block-str ?bare)])
                         [(get-else $ ?b :create/time 0) ?block-create-time]
                         [(get-else $ ?b :edit/time 0) ?block-edit-time]]`;
      queryParams = [bracketed, bare, targetPageUid];
    } else {
      queryStr = `[:find ?block-uid ?block-str ?page-title ?block-create-time ?block-edit-time
                  :in $ ?bracketed ?bare
                  :where [?b :block/string ?block-str]
                         [?b :block/uid ?block-uid]
                         [?b :block/page ?p]
                         [?p :node/title ?page-title]
                         (or [(clojure.string/includes? ?block-str ?bracketed)]
                             [(clojure.string/includes? ?block-str ?bare)])
                         [(get-else $ ?b :create/time 0) ?block-create-time]
                         [(get-else $ ?b :edit/time 0) ?block-edit-time]]`;
      queryParams = [bracketed, bare];
    }

    const rawResults = await q(this.graph, queryStr, queryParams) as [string, string, string?, number?, number?][];

    // Resolve block references in content
    const resolvedResults = await this.resolveBlockRefs(rawResults);
    
    return SearchUtils.formatSearchResults(resolvedResults, `with status ${status}`, !targetPageUid);
  }
}
