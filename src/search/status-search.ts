import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { BaseSearchHandler, SearchResult } from './types.js';
import { SearchUtils } from './utils.js';
import { resolveRefs } from '../tools/helpers/refs.js';

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

    // Search for "{{TODO" or "{{DONE" which matches both {{[[TODO]]}} and {{TODO}} formats
    if (targetPageUid) {
      queryStr = `[:find ?block-uid ?block-str ?page-title ?block-create-time ?block-edit-time
                  :in $ ?status ?page-uid
                  :where [?p :block/uid ?page-uid]
                         [?p :node/title ?page-title]
                         [?b :block/page ?p]
                         [?b :block/string ?block-str]
                         [?b :block/uid ?block-uid]
                         [(clojure.string/includes? ?block-str (str "{{" ?status))]
                         [(get-else $ ?b :create/time 0) ?block-create-time]
                         [(get-else $ ?b :edit/time 0) ?block-edit-time]]`;
      queryParams = [status, targetPageUid];
    } else {
      queryStr = `[:find ?block-uid ?block-str ?page-title ?block-create-time ?block-edit-time
                  :in $ ?status
                  :where [?b :block/string ?block-str]
                         [?b :block/uid ?block-uid]
                         [?b :block/page ?p]
                         [?p :node/title ?page-title]
                         [(clojure.string/includes? ?block-str (str "{{" ?status))]
                         [(get-else $ ?b :create/time 0) ?block-create-time]
                         [(get-else $ ?b :edit/time 0) ?block-edit-time]]`;
      queryParams = [status];
    }

    const rawResults = await q(this.graph, queryStr, queryParams) as [string, string, string?, number?, number?][];

    // Resolve block references in content
    const resolvedResults = await Promise.all(
      rawResults.map(async ([uid, content, pageTitle, created, modified]) => {
        const resolvedContent = await resolveRefs(this.graph, content);
        return [uid, resolvedContent, pageTitle, created, modified] as [string, string, string?, number?, number?];
      })
    );
    
    return SearchUtils.formatSearchResults(resolvedResults, `with status ${status}`, !targetPageUid);
  }
}
