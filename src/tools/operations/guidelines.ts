/**
 * Per-graph agent guidelines.
 *
 * A page in the graph — conventionally `[[roam/agent guidelines]]` — holding
 * the user's own conventions: how they tag, how they name pages, what to never do.
 * This is the same page Roam's official MCP server reads, so a user writes their
 * conventions once and both servers honour them.
 *
 * Distinct from the markdown cheatsheet, which is Roam *syntax* plus this
 * server's mechanics and lives in a file. Guidelines are per-graph, live-edited
 * from inside Roam, and answer "how does this user want their graph handled".
 *
 * Read by default; set `guidelinesPage: false` on a graph to disable it there.
 */

import type { Graph } from '@roam-research/roam-api-sdk';
import { PageOperations } from './pages.js';
import { formatRoamDate } from '../../utils/helpers.js';

/** The shared convention, read by default and by Roam's own MCP server. */
export const DEFAULT_GUIDELINES_PAGE = 'roam/agent guidelines';

export interface GuidelinesResult {
  /** The page consulted, or null when guidelines are disabled for this graph. */
  page: string | null;
  exists: boolean;
  guidelines: string | null;
  /** Today's daily note title, in Roam's ordinal format — useful orientation. */
  todaysDailyNote: string;
  nextSteps: string;
}

interface CacheEntry {
  at: number;
  result: GuidelinesResult;
}

/**
 * Short TTL: the point of a page over a config file is that an edit takes
 * effect without a restart, so this must not be long. Long enough that a burst
 * of tool calls in one exchange costs a single fetch.
 */
const TTL_MS = 30_000;
const cache = new WeakMap<Graph, Map<string, CacheEntry>>();

export class GuidelinesOperations {
  private pageOps: PageOperations;

  /**
   * @param guidelinesPage Page title to read, or null when disabled for this graph.
   */
  constructor(
    private graph: Graph,
    private guidelinesPage: string | null = DEFAULT_GUIDELINES_PAGE
  ) {
    this.pageOps = new PageOperations(graph);
  }

  /** Drop the memoised result — used by tests and after a known edit. */
  clearCache(): void {
    cache.delete(this.graph);
  }

  async getGuidelines(): Promise<GuidelinesResult> {
    const today = formatRoamDate(new Date());

    if (!this.guidelinesPage) {
      return {
        page: null,
        exists: false,
        guidelines: null,
        todaysDailyNote: today,
        nextSteps:
          'Guidelines are disabled for this graph. Proceed using the Roam Markdown Cheatsheet for syntax.',
      };
    }

    const perGraph = cache.get(this.graph) ?? new Map<string, CacheEntry>();
    const hit = perGraph.get(this.guidelinesPage);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return hit.result;
    }

    let result: GuidelinesResult;
    try {
      const uid = await this.pageOps.getPageUid(this.guidelinesPage);
      if (!uid) {
        result = {
          page: this.guidelinesPage,
          exists: false,
          guidelines: null,
          todaysDailyNote: today,
          nextSteps:
            `No "${this.guidelinesPage}" page exists in this graph, so there are no user conventions to follow. ` +
            `Do not call this tool again for this graph this session. Proceed using the Roam Markdown Cheatsheet for syntax. ` +
            `The user can create the page at any time to set conventions.`,
        };
      } else {
        // Rendered through the normal page path, so blocks the user tagged
        // #.rm-hide / #.rm-private are withheld here too. Guidelines get no
        // special exemption — a section tagged private was tagged deliberately.
        const guidelines = await this.pageOps.fetchPageByTitle(this.guidelinesPage, 'markdown');
        result = {
          page: this.guidelinesPage,
          exists: true,
          guidelines,
          todaysDailyNote: today,
          nextSteps:
            `You now have this graph's conventions. Do not call this tool again for this graph this session — you already have what you need. ` +
            `Apply these conventions to reads as well as writes: they change how results should be interpreted and presented, not just how content is written. ` +
            `Today's daily note is "${today}".`,
        };
      }
    } catch (error) {
      // Never let a guidelines lookup break the tool the agent actually wanted.
      result = {
        page: this.guidelinesPage,
        exists: false,
        guidelines: null,
        todaysDailyNote: today,
        nextSteps:
          `Could not read "${this.guidelinesPage}" (${error instanceof Error ? error.message : String(error)}). ` +
          `Proceed using the Roam Markdown Cheatsheet for syntax.`,
      };
    }

    perGraph.set(this.guidelinesPage, { at: Date.now(), result });
    cache.set(this.graph, perGraph);
    return result;
  }
}
