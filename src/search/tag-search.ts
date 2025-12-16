import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { BaseSearchHandler, TagSearchParams, SearchResult } from './types.js';
import { SearchUtils } from './utils.js';
import { resolveRefs } from '../tools/helpers/refs.js';

export class TagSearchHandler extends BaseSearchHandler {
  constructor(
    graph: Graph,
    private params: TagSearchParams
  ) {
    super(graph);
  }

  async execute(): Promise<SearchResult> {
    const { primary_tag, page_title_uid, near_tag, exclude_tag, case_sensitive = false, limit = -1, offset = 0 } = this.params;

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

    const searchTags: string[] = [];
    if (case_sensitive) {
      searchTags.push(primary_tag);
    } else {
      searchTags.push(primary_tag);
      searchTags.push(primary_tag.charAt(0).toUpperCase() + primary_tag.slice(1));
      searchTags.push(primary_tag.toUpperCase());
      searchTags.push(primary_tag.toLowerCase());
    }

    const tagWhereClauses = searchTags.map(tag => {
      // Roam tags can be [[tag name]] or #tag-name or #[[tag name]]
      // The :node/title for a tag page is just the tag name without any # or [[ ]]
      return `[?ref-page :node/title "${tag}"]`;
    }).join(' ');

    let inClause = `:in $`;
    let queryLimit = limit === -1 ? '' : `:limit ${limit}`;
    let queryOffset = offset === 0 ? '' : `:offset ${offset}`;
    let queryOrder = `:order ?page-edit-time asc ?block-uid asc`; // Sort by page edit time, then block UID

    let queryWhereClauses = `
                      (or ${tagWhereClauses})
                      [?b :block/refs ?ref-page]
                      [?b :block/string ?block-str]
                      [?b :block/uid ?block-uid]
                      [?b :block/page ?p]
                      [?p :node/title ?page-title]
                      [?p :edit/time ?page-edit-time]`; // Fetch page edit time for sorting

    if (nearTagUid) {
      queryWhereClauses += `
                      [?b :block/refs ?near-tag-page]
                      [?near-tag-page :block/uid "${nearTagUid}"]`;
    }

    if (excludeTagUid) {
      queryWhereClauses += `
                      (not [?b :block/refs ?exclude-tag-page])
                      [?exclude-tag-page :block/uid "${excludeTagUid}"]`;
    }

    if (targetPageUid) {
      inClause += ` ?target-page-uid`;
      queryWhereClauses += `
                      [?p :block/uid ?target-page-uid]`;
    }

    const queryStr = `[:find ?block-uid ?block-str ?page-title
                      ${inClause} ${queryLimit} ${queryOffset} ${queryOrder}
                      :where 
                      ${queryWhereClauses}]`;

    const queryArgs: (string | number)[] = [];
    if (targetPageUid) {
      queryArgs.push(targetPageUid);
    }

    const rawResults = await q(this.graph, queryStr, queryArgs) as [string, string, string?][];

    // Query to get total count without limit
    const countQueryStr = `[:find (count ?b)
                            ${inClause}
                            :where
                            ${queryWhereClauses.replace(/\[\?p :edit\/time \?page-edit-time\]/, '')}]`; // Remove edit time for count query

    const totalCountResults = await q(this.graph, countQueryStr, queryArgs) as number[][];
    const totalCount = totalCountResults[0] ? totalCountResults[0][0] : 0;

    // Resolve block references in content
    const resolvedResults = await Promise.all(
      rawResults.map(async ([uid, content, pageTitle]) => {
        const resolvedContent = await resolveRefs(this.graph, content);
        return [uid, resolvedContent, pageTitle] as [string, string, string?];
      })
    );

    const searchDescription = `referencing "${primary_tag}"`;
    const formattedResults = SearchUtils.formatSearchResults(resolvedResults, searchDescription, !targetPageUid);
    formattedResults.total_count = totalCount;
    return formattedResults;
  }
}
