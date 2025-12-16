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

    if (targetPageUid) {
      queryStr = `[:find ?block-uid ?block-str
                  :in $ ?status ?page-uid
                  :where [?p :block/uid ?page-uid]
                         [?b :block/page ?p]
         [?b :block/string ?block-str]
         [?b :block/uid ?block-uid]
         [(clojure.string/includes? ?block-str (str "{{[[" ?status "]]}}"))]]`;
      queryParams = [status, targetPageUid];
    } else {
      queryStr = `[:find ?block-uid ?block-str ?page-title
                  :in $ ?status
                  :where [?b :block/string ?block-str]
                         [?b :block/uid ?block-uid]
                         [?b :block/page ?p]
                         [?p :node/title ?page-title]
                         [(clojure.string/includes? ?block-str (str "{{[[" ?status "]]}}"))]]`;
      queryParams = [status];
    }

    const rawResults = await q(this.graph, queryStr, queryParams) as [string, string, string?][];
    
    // Resolve block references in content
    const resolvedResults = await Promise.all(
      rawResults.map(async ([uid, content, pageTitle]) => {
        const resolvedContent = await resolveRefs(this.graph, content);
        return [uid, resolvedContent, pageTitle] as [string, string, string?];
      })
    );
    
    return SearchUtils.formatSearchResults(resolvedResults, `with status ${status}`, !targetPageUid);
  }
}
