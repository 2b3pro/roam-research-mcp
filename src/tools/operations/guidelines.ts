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
 * The result also carries `roamSyntax` (see `../roam-syntax.ts`) on every path,
 * whether or not a guidelines page exists. Conventions are the user's to supply
 * and may be absent; the data-safety rules are the server's and never are.
 *
 * Read by default; set `guidelinesPage: false` on a graph to disable it there.
 * Disabling suppresses the user's conventions, not `roamSyntax`.
 */

import type { Graph } from '@roam-research/roam-api-sdk';
import { PageOperations } from './pages.js';
import { formatRoamDate } from '../../utils/helpers.js';
import { ROAM_SYNTAX } from '../roam-syntax.js';

/** The shared convention, read by default and by Roam's own MCP server. */
export const DEFAULT_GUIDELINES_PAGE = 'roam/agent guidelines';

export interface GuidelinesResult {
  /** The page consulted, or null when guidelines are disabled for this graph. */
  page: string | null;
  exists: boolean;
  guidelines: string | null;
  /**
   * The data-safety rules from `ROAM_SYNTAX`, on every result — including when
   * no guidelines page exists, when they are disabled, and when the read
   * failed. The user's conventions are optional; these are not, and this call
   * is the one channel that reaches a client which never fetches the
   * cheatsheet. Constant, so it does not affect caching.
   */
  roamSyntax: string;
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
        roamSyntax: ROAM_SYNTAX,
        todaysDailyNote: today,
        nextSteps:
          'Guidelines are disabled for this graph. Follow `roamSyntax` below, and load the Roam Markdown Cheatsheet for anything it does not cover.',
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
          roamSyntax: ROAM_SYNTAX,
          todaysDailyNote: today,
          nextSteps:
            `No "${this.guidelinesPage}" page exists in this graph, so there are no user conventions to follow. ` +
            `Do not call this tool again for this graph this session. The \`roamSyntax\` rules below still apply — they are about data safety, not convention. ` +
            `Load the Roam Markdown Cheatsheet for syntax they do not cover. ` +
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
          roamSyntax: ROAM_SYNTAX,
          todaysDailyNote: today,
          nextSteps:
            `You now have this graph's conventions. Do not call this tool again for this graph this session — you already have what you need. ` +
            `Apply these conventions to reads as well as writes: they change how results should be interpreted and presented, not just how content is written. ` +
            `Where they are silent, the \`roamSyntax\` rules govern; where they conflict, conventions win on style and \`roamSyntax\` wins on data safety. ` +
            `Today's daily note is "${today}".`,
        };
      }
    } catch (error) {
      // Never let a guidelines lookup break the tool the agent actually wanted.
      result = {
        page: this.guidelinesPage,
        exists: false,
        guidelines: null,
        roamSyntax: ROAM_SYNTAX,
        todaysDailyNote: today,
        nextSteps:
          `Could not read "${this.guidelinesPage}" (${error instanceof Error ? error.message : String(error)}). ` +
          `The graph's conventions are unavailable, so be conservative about placement and style. ` +
          `The \`roamSyntax\` rules below are unaffected — they ship with the server. ` +
          `Load the Roam Markdown Cheatsheet for syntax they do not cover.`,
      };
    }

    perGraph.set(this.guidelinesPage, { at: Date.now(), result });
    cache.set(this.graph, perGraph);
    return result;
  }
}
