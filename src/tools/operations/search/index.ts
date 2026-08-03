import { Graph } from '@roam-research/roam-api-sdk';
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

  async searchForTag(
    primary_tag: string,
    page_title_uid?: string,
    near_tag?: string
  ): Promise<SearchHandlerResult> {
    const handler = new TagSearchHandlerImpl(this.graph, {
      primary_tag,
      page_title_uid,
      near_tag,
    });
    return this.withoutHidden(await handler.execute());
  }

  async searchBlockRefs(params: BlockRefSearchParams): Promise<SearchHandlerResult> {
    const handler = new BlockRefSearchHandlerImpl(this.graph, params);
    return this.withoutHidden(await handler.execute());
  }

  async searchHierarchy(params: HierarchySearchParams): Promise<SearchHandlerResult> {
    const handler = new HierarchySearchHandlerImpl(this.graph, params);
    return this.withoutHidden(await handler.execute());
  }

  async searchByText(params: TextSearchParams): Promise<SearchHandlerResult> {
    const handler = new TextSearchHandlerImpl(this.graph, params);
    return this.withoutHidden(await handler.execute());
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
    include_content: boolean;
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
    // Convert dates to timestamps
    const startTimestamp = new Date(`${params.start_date}T00:00:00`).getTime();
    const endTimestamp = params.end_date ? new Date(`${params.end_date}T23:59:59`).getTime() : undefined;

    // Use text search handler for content-based filtering
    const handler = new TextSearchHandlerImpl(this.graph, {
      text: '', // Empty text to match all blocks
    });

    // Filtered before the map below, which renames block_uid -> uid; after it
    // the hidden-UID closure would have nothing to match on.
    const result = await this.withoutHidden(await handler.execute());

    // Filter results by date
    const matches = result.matches
      .filter(match => {
        const time = params.type === 'created' ? 
          new Date(match.content || '').getTime() : // Use content date for creation time
          Date.now(); // Use current time for modification time (simplified)
        
        return time >= startTimestamp && (!endTimestamp || time <= endTimestamp);
      })
      .map(match => ({
        uid: match.block_uid,
        type: 'block',
        time: params.type === 'created' ? 
          new Date(match.content || '').getTime() : 
          Date.now(),
        ...(params.include_content && { content: match.content }),
        page_title: match.page_title
      }));

    // Sort by time
    const sortedMatches = matches.sort((a, b) => b.time - a.time);

    return {
      success: true,
      matches: sortedMatches,
      message: `Found ${sortedMatches.length} matches for the given date range and criteria`
    };
  }
}
