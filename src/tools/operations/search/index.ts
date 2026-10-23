import { Graph, q } from '@roam-research/roam-api-sdk';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { SearchResult } from '../../types/index.js';
import type {
  TagSearchParams,
  BlockRefSearchParams,
  HierarchySearchParams,
  TextSearchParams,
  SearchHandlerResult
} from './types.js';
import {
  TagSearchHandlerImpl,
  BlockRefSearchHandlerImpl,
  HierarchySearchHandlerImpl,
  TextSearchHandlerImpl,
  StatusSearchHandlerImpl,
  DatomicSearchHandlerImpl
} from './handlers.js';
import type { DatomicSearchParams } from './types.js';
import { collectHiddenUids, filterHiddenMatches } from '../../helpers/hidden.js';
import { resolveRefs } from '../../helpers/refs.js';

export interface SearchPageOptions {
  limit?: number;
  offset?: number;
  /** Internal CLI filters, evaluated on original content before paging. */
  filter?: (match: SearchResult) => boolean;
}

export function validateSearchPage({ limit = -1, offset = 0 }: SearchPageOptions): void {
  if (!Number.isSafeInteger(limit) || limit < -1 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new McpError(ErrorCode.InvalidParams, 'limit must be -1 or a non-negative integer; offset must be a non-negative integer.');
  }
}

export class SearchOperations {
  constructor(private graph: Graph) {}

  /**
   * Withhold blocks the user tagged #.rm-hide / #.rm-private, and blocks nested
   * under them.
   *
   * Search results are flat, so unlike a page tree they carry no ancestry —
   * hence the UID closure from `collectHiddenUids`. Applied to every
   * content-search path below, and deliberately NOT to `executeDatomicQuery`:
   * raw Datalog reads the database directly and stays raw, matching the
   * official Roam toolset. That is also why these tags are a convenience
   * filter, not a security boundary.
   */
  private async withoutHidden(result: SearchHandlerResult): Promise<SearchHandlerResult> {
    if (!result?.matches?.length) return result;
    const hidden = await collectHiddenUids(this.graph);
    const matches = filterHiddenMatches(result.matches, hidden);
    const removed = result.matches.length - matches.length;
    if (removed === 0) return result;

    // Some handlers attach a total_count that isn't on SearchHandlerResult;
    // keep it consistent with the matches we actually return rather than
    // reporting a total that includes withheld blocks.
    const withCount = result as SearchHandlerResult & { total_count?: number };
    return {
      ...result,
      matches,
      ...(typeof withCount.total_count === 'number'
        ? { total_count: Math.max(0, withCount.total_count - removed) }
        : {}),
    };
  }

  async searchByStatus(
    status: 'TODO' | 'DONE',
    page_title_uid?: string,
    include?: string,
    exclude?: string
  ): Promise<SearchHandlerResult> {
    const handler = new StatusSearchHandlerImpl(this.graph, {
      status,
      page_title_uid,
    });
    const result = await this.withoutHidden(await handler.execute());

    // Post-process results with include/exclude filters
    let matches = result.matches;

    if (include) {
      const includeTerms = include.split(',').map(term => term.trim());
      matches = matches.filter((match: SearchResult) => {
        const matchContent = match.content;
        const matchTitle = match.page_title;
        const terms = includeTerms;
        return terms.some(term => 
          matchContent.includes(term) ||
          (matchTitle && matchTitle.includes(term))
        );
      });
    }

    if (exclude) {
      const excludeTerms = exclude.split(',').map(term => term.trim());
      matches = matches.filter((match: SearchResult) => {
        const matchContent = match.content;
        const matchTitle = match.page_title;
        const terms = excludeTerms;
        return !terms.some(term => 
          matchContent.includes(term) ||
          (matchTitle && matchTitle.includes(term))
        );
      });
    }

    return {
      success: true,
      matches,
      message: `Found ${matches.length} block(s) with status ${status}${include ? ` including "${include}"` : ''}${exclude ? ` excluding "${exclude}"` : ''}`
    };
  }

  private async pageResults(result: SearchHandlerResult, options: SearchPageOptions, pageTitles = false): Promise<SearchHandlerResult> {
    if (!result.success) return result;
    const visible = await this.withoutHidden(result);
    const filtered = visible.matches.filter(options.filter ?? (() => true));
    // A stable tie-breaker is required: backend relation rows have no order.
    filtered.sort((a, b) => pageTitles
      ? a.content.localeCompare(b.content) || a.block_uid.localeCompare(b.block_uid)
      : a.block_uid.localeCompare(b.block_uid));
    const { limit = -1, offset = 0 } = options;
    const selected = filtered.slice(offset, limit === -1 ? undefined : offset + limit);
    const matches = pageTitles ? selected : await Promise.all(selected.map(async match => ({
      ...match, content: await resolveRefs(this.graph, match.content),
    })));
    return { ...result, matches, total_count: filtered.length,
      message: `Found ${filtered.length} matching result(s); returning ${matches.length}.` };
  }

  async searchForTag(
    primary_tag: string,
    page_title_uid?: string,
    near_tag?: string,
    case_sensitive?: boolean,
    options: SearchPageOptions = {},
  ): Promise<SearchHandlerResult> {
    validateSearchPage(options);
    const handler = new TagSearchHandlerImpl(this.graph, { primary_tag, page_title_uid, near_tag, case_sensitive });
    return this.pageResults(await handler.execute(), options);
  }

  /** Union all tag candidates before filtering/paging; first-tag seeding loses OR matches. */
  async searchForTags(tags: string[], page_title_uid: string | undefined, any: boolean, options: SearchPageOptions): Promise<SearchHandlerResult> {
    validateSearchPage(options);
    const results = await Promise.all((any ? tags : tags.slice(0, 1)).map(primary_tag =>
      new TagSearchHandlerImpl(this.graph, { primary_tag, page_title_uid }).execute()));
    const matches = [...new Map(results.flatMap(result => result.matches).map(match => [match.block_uid, match])).values()];
    return this.pageResults({ success: true, matches, message: '' }, options);
  }

  async searchBlockRefs(params: BlockRefSearchParams): Promise<SearchHandlerResult> {
    const handler = new BlockRefSearchHandlerImpl(this.graph, params);
    return this.withoutHidden(await handler.execute());
  }

  async searchHierarchy(params: HierarchySearchParams): Promise<SearchHandlerResult> {
    const handler = new HierarchySearchHandlerImpl(this.graph, params);
    return this.withoutHidden(await handler.execute());
  }

  async searchByText(params: TextSearchParams, options: SearchPageOptions = {}): Promise<SearchHandlerResult> {
    const page = { ...params, ...options };
    validateSearchPage(page);
    const handler = new TextSearchHandlerImpl(this.graph, params);
    return this.pageResults(await handler.execute(), page, params.scope === 'page_titles');
  }

  async executeDatomicQuery(params: DatomicSearchParams): Promise<SearchHandlerResult> {
    // Intentionally NOT filtered — raw Datalog reads the database directly and
    // stays raw. See the note on withoutHidden(): the hide tags are a
    // convenience filter for the content tools, not a security boundary.
    const handler = new DatomicSearchHandlerImpl(this.graph, params);
    return handler.execute();
  }

  async searchByDate(params: {
    start_date: string;
    end_date?: string;
    type: 'created' | 'modified' | 'both';
    scope: 'blocks' | 'pages' | 'both';
    include_content?: boolean;
  }): Promise<{ 
    success: boolean; 
    matches: Array<{ 
      uid: string; 
      type: string; 
      time: number; 
      content?: string; 
      page_title?: string 
    }>; 
    message: string 
  }> {
    const parseDay = (value: string): Date => {
      const day = new Date(`${value}T00:00:00`);
      const parts = value.split('-').map(Number);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(day.getTime()) ||
          day.getFullYear() !== parts[0] || day.getMonth() + 1 !== parts[1] || day.getDate() !== parts[2]) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid date "${value}"; expected YYYY-MM-DD.`);
      }
      return day;
    };
    const start = parseDay(params.start_date).getTime();
    const endDay = params.end_date === undefined ? undefined : parseDay(params.end_date);
    if (endDay && endDay.getTime() < start) {
      throw new McpError(ErrorCode.InvalidParams, 'end_date must be on or after start_date.');
    }
    // Next calendar midnight includes the entire final day, including .999,
    // and handles days shortened or lengthened by daylight-saving transitions.
    endDay?.setDate(endDay.getDate() + 1);
    const inputs = endDay ? [start, endDay.getTime()] : [start];
    const timeClause = params.type === 'both'
      ? '(or [?e :create/time ?time] [?e :edit/time ?time])'
      : `[?e :${params.type === 'created' ? 'create' : 'edit'}/time ?time]`;
    const scopes: Array<'block' | 'page'> = params.scope === 'both'
      ? ['block', 'page'] : [params.scope === 'pages' ? 'page' : 'block'];

    const results = await Promise.all(scopes.map(async type => {
      const entityClause = type === 'block'
        ? `[?e :block/string ?content]
           [?e :block/page ?page]
           [?page :node/title ?page-title]`
        : `[?e :node/title ?content]
           [?e :node/title ?page-title]`;
      const query = `[:find ?uid ?content ?page-title ?time
                      :in $ ?start ${endDay ? '?end' : ''}
                      :where [?e :block/uid ?uid]
                             ${entityClause}
                             ${timeClause}
                             [(>= ?time ?start)]
                             ${endDay ? '[(< ?time ?end)]' : ''}]`;
      const rows = await q(this.graph, query, inputs) as [string, string, string, number][];
      return rows.map(([block_uid, content, page_title, time]) => ({ block_uid, content, page_title, time, type }));
    }));

    const hidden = await collectHiddenUids(this.graph);
    const visible = filterHiddenMatches(results.flat(), hidden);
    const matchesByUid = new Map<string, typeof visible[number]>();
    for (const match of visible) {
      const previous = matchesByUid.get(match.block_uid);
      // With type=both an entity may match twice. Return it once, with the
      // latest timestamp that actually falls inside the requested range.
      if (!previous || match.time > previous.time) matchesByUid.set(match.block_uid, match);
    }
    const matches = await Promise.all([...matchesByUid.values()]
      .map(async ({ block_uid, content, ...match }) => ({
        uid: block_uid,
        ...match,
        ...(params.include_content !== false && { content: await resolveRefs(this.graph, content) }),
      })));
    const sortedMatches = matches.sort((a, b) => b.time - a.time || a.uid.localeCompare(b.uid));

    return {
      success: true,
      matches: sortedMatches,
      message: `Found ${sortedMatches.length} matches for the given date range and criteria`
    };
  }
}
