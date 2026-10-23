import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { BaseSearchHandler, TagSearchParams, SearchResult } from './types.js';
import { SearchUtils } from './utils.js';
import { ednString } from '../shared/datalog.js';

export class TagSearchHandler extends BaseSearchHandler {
  constructor(
    graph: Graph,
    private params: TagSearchParams
  ) {
    super(graph);
  }

  async execute(): Promise<SearchResult> {
    const { primary_tag, page_title_uid, near_tag, exclude_tag, case_sensitive = false } = this.params;

    let nearTagUid: string | undefined;
    if (near_tag) {
      nearTagUid = await SearchUtils.findPageByTitleOrUid(this.graph, near_tag);
      if (!nearTagUid) {
        return {
          success: false,
          matches: [],
          message: `Near tag "${near_tag}" not found.`,
          total_count: 0
        };
      }
    }

    let excludeTagUid: string | undefined;
    if (exclude_tag) {
      excludeTagUid = await SearchUtils.findPageByTitleOrUid(this.graph, exclude_tag);
      if (!excludeTagUid) {
        return {
          success: false,
          matches: [],
          message: `Exclude tag "${exclude_tag}" not found.`,
          total_count: 0
        };
      }
    }

    // Get target page UID if provided for scoped search
    let targetPageUid: string | undefined;
    if (page_title_uid) {
      targetPageUid = await SearchUtils.findPageByTitleOrUid(this.graph, page_title_uid);
    }

    const tagMatchClause = SearchUtils.buildTagMatchClause(primary_tag, '?ref-page', case_sensitive);

    let inClause = `:in $`;
    let queryWhereClauses = `
                      ${tagMatchClause}
                      [?b :block/refs ?ref-page]
                      [?b :block/string ?block-str]
                      [?b :block/uid ?block-uid]
                      [?b :block/page ?p]
                      [?p :node/title ?page-title]
                      [(get-else $ ?b :create/time 0) ?block-create-time]
                      [(get-else $ ?b :edit/time 0) ?block-edit-time]`; // Block timestamps for CLI sort/group

    if (nearTagUid) {
      queryWhereClauses += `
                      [?b :block/refs ?near-tag-page]
                      [?near-tag-page :block/uid ${ednString(nearTagUid)}]`;
    }

    if (excludeTagUid) {
      queryWhereClauses += `
                      (not [?b :block/refs ?exclude-tag-page])
                      [?exclude-tag-page :block/uid ${ednString(excludeTagUid)}]`;
    }

    if (targetPageUid) {
      inClause += ` ?target-page-uid`;
      queryWhereClauses += `
                      [?p :block/uid ?target-page-uid]`;
    }

    const queryStr = `[:find ?block-uid ?block-str ?page-title ?block-create-time ?block-edit-time
                      ${inClause}
                      :where
                      ${queryWhereClauses}]`;

    const queryArgs: (string | number)[] = [];
    if (targetPageUid) {
      queryArgs.push(targetPageUid);
    }

    const rawResults = await q(this.graph, queryStr, queryArgs) as [string, string, string?, number?, number?][];

    const formattedResults = SearchUtils.formatSearchResults(rawResults, `referencing "${primary_tag}"`, !targetPageUid);
    return formattedResults;
  }
}
