import { Command } from 'commander';
import { SearchOperations, validateSearchPage } from '../../tools/operations/search/index.js';
import {
  formatSearchResults,
  printDebug,
  exitWithError,
  type OutputOptions
} from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';
import { readStdin } from '../utils/input.js';

/**
 * Normalize a tag by stripping #, [[, ]] wrappers
 */
function normalizeTag(tag: string): string {
  return tag.replace(/^#?\[?\[?/, '').replace(/\]?\]?$/, '');
}

/**
 * Check if content contains a tag (handles #tag, [[tag]], #[[tag]] formats)
 */
function contentHasTag(content: string, tag: string): boolean {
  const normalized = normalizeTag(tag);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\[\\[${escaped}\\]\\]|#${escaped}(?![\\p{L}\\p{N}_/-])`, 'iu').test(content);
}

interface SearchOptions extends GraphOptions {
  tag?: string[];
  negtag?: string[];
  page?: string;
  caseInsensitive?: boolean;
  limit?: string;
  offset?: string;
  json?: boolean;
  debug?: boolean;
  query?: string;
  inputs?: string;
  regex?: string;
  regexFlags?: string;
  any?: boolean;
  namespace?: string;
}

export function createSearchCommand(): Command {
  return new Command('search')
    .description('Search blocks by text, tags, Datalog queries, or within specific pages')
    .argument('[terms...]', 'Search terms (multiple terms use AND logic). Reads from stdin if omitted.')
    .option('--tag <tag>', 'Filter by tag (repeatable, comma-separated). Default: AND logic', (val, prev: string[]) => {
      // Support both comma-separated and multiple flags
      const tags = val.split(',').map(t => t.trim()).filter(Boolean);
      return prev ? [...prev, ...tags] : tags;
    }, [] as string[])
    .option('--any', 'Use OR logic for multiple tags (default is AND)')
    .option('--negtag <tag>', 'Exclude blocks with tag (repeatable, comma-separated)', (val, prev: string[]) => {
      const tags = val.split(',').map(t => t.trim()).filter(Boolean);
      return prev ? [...prev, ...tags] : tags;
    }, [] as string[])
    .option('--page <title>', 'Scope search to a specific page')
    .option('-i, --case-insensitive', 'Case-insensitive search')
    .option('-n, --limit <n>', 'Limit results; -1 returns all (default: 20)', '20')
    .option('--offset <n>', 'Skip matching results after filtering (default: 0)', '0')
    .option('--json', 'Output as JSON')
    .option('--debug', 'Show query metadata')
    .option('-g, --graph <name>', 'Target graph key (for multi-graph mode)')
    .option('-q, --query <datalog>', 'Raw Datalog query (bypasses other search options)')
    .option('--inputs <json>', 'JSON array of inputs for Datalog query')
    .option('--regex <pattern>', 'Client-side regex filter on Datalog results')
    .option('--regex-flags <flags>', 'Regex flags (e.g., "i" for case-insensitive)')
    .option('--namespace <prefix>', 'Search for pages by namespace prefix (e.g., "Convention" finds "Convention/*")')
    .addHelpText('after', `
Examples:
  # Text search
  roam search "meeting notes"               # Find blocks containing text
  roam search api integration               # Multiple terms (AND logic)

  # Namespace search (find pages by title prefix)
  roam search --namespace Convention        # Find all Convention/* pages
  roam search --namespace "Convention/"     # Same (trailing slash optional)

  # Stdin search
  echo "urgent project" | roam search       # Pipe terms
  roam get today | roam search TODO         # Search within output

  # Tag search
  roam search --tag TODO                    # All blocks with #TODO
  roam search --tag "[[Project Alpha]]"     # Blocks with page reference

  # Datalog queries (advanced)
  roam search -q '[:find ?uid ?s :where [?b :block/uid ?uid] [?b :block/string ?s]]' --regex "meeting"

  # Chaining with jq
  roam search TODO --json | jq '.[].block_uid'

Output format:
  Markdown: Flat results with UIDs and content (no hierarchy).
  JSON:     [{ block_uid, content, page_title }] or [{ page_uid, page_title }] for namespace

Note: For hierarchical output with children, use 'roam get --tag/--text' instead.
`)
    .action(async (terms: string[], options: SearchOptions) => {
      try {
        const graph = resolveGraph(options, false);

        const limit = Number(options.limit ?? '20');
        const offset = Number(options.offset ?? '0');
        validateSearchPage({ limit, offset });
        const outputOptions: OutputOptions = {
          json: options.json,
          debug: options.debug
        };

        let searchTerms = terms;

        // If no terms provided as args, try stdin
        if (searchTerms.length === 0 && !process.stdin.isTTY && !options.query && (options.tag?.length === 0)) {
           const input = await readStdin();
           if (input) {
             searchTerms = input.trim().split(/\s+/);
           }
        }

        if (options.debug) {
          printDebug('Search terms', searchTerms);
          printDebug('Graph', options.graph || 'default');
          printDebug('Options', options);
        }

        const searchOps = new SearchOperations(graph);

        // Namespace search mode (search page titles by prefix)
        if (options.namespace) {
          const result = await searchOps.searchByText({
            text: options.namespace,
            scope: 'page_titles', limit, offset
          });

          if (!result.success) {
            exitWithError(result.message || 'Namespace search failed');
          }

          const matches = result.matches;

          if (options.json) {
            // For JSON output, return page_uid and page_title
            const jsonMatches = matches.map(m => ({
              page_uid: m.block_uid,
              page_title: m.page_title
            }));
            console.log(JSON.stringify(jsonMatches, null, 2));
          } else {
            if (matches.length === 0) {
              console.log('No pages found.');
            } else {
              console.log(`Found ${result.total_count ?? matches.length} page(s) (showing ${matches.length}, offset ${offset}):\n`);
              for (const match of matches) {
                console.log(`- ${match.page_title} (${match.block_uid})`);
              }
            }
          }
          return;
        }

        // Datalog query mode (bypasses other search options)
        if (options.query) {
          // Parse inputs if provided
          let inputs: unknown[] | undefined;
          if (options.inputs) {
            try {
              inputs = JSON.parse(options.inputs);
              if (!Array.isArray(inputs)) {
                exitWithError('--inputs must be a JSON array');
              }
            } catch {
              exitWithError('Invalid JSON in --inputs');
            }
          }

          const result = await searchOps.executeDatomicQuery({
            query: options.query,
            inputs,
            regexFilter: options.regex,
            regexFlags: options.regexFlags
          });

          if (!result.success) {
            exitWithError(result.message || 'Query failed');
          }

          // Apply limit and format output
          const limitedMatches = result.matches.slice(offset, limit === -1 ? undefined : offset + limit);

          if (options.json) {
            const parsed = limitedMatches.map(m => {
              try {
                return JSON.parse(m.content);
              } catch {
                return m.content;
              }
            });
            console.log(JSON.stringify(parsed, null, 2));
          } else {
            if (limitedMatches.length === 0) {
              console.log('No results found.');
            } else {
              console.log(`Found ${result.matches.length} results (showing ${limitedMatches.length}, offset ${offset}):\n`);
              for (const match of limitedMatches) {
                console.log(match.content);
              }
            }
          }
          return;
        }

        const tags = (options.tag || []).map(normalizeTag);
        const negTags = (options.negtag || []).map(normalizeTag);
        const page = {
          limit, offset,
          filter: (match: { content: string }) =>
            (tags.length === 0 || (options.any
              ? tags.some(tag => contentHasTag(match.content, tag))
              : tags.every(tag => contentHasTag(match.content, tag)))) &&
            !negTags.some(tag => contentHasTag(match.content, tag)),
        };
        let result;
        if (tags.length > 0 && searchTerms.length === 0) {
          result = await searchOps.searchForTags(tags, options.page, options.any || false, page);
        } else if (searchTerms.length > 0) {
          result = await searchOps.searchByText({
            text: searchTerms.join(' '), page_title_uid: options.page,
          }, page);
        } else {
          exitWithError('Please provide search terms or use --tag to search by tag');
        }
        if (!result.success) exitWithError(result.message || 'Search failed');
        console.log(formatSearchResults(result.matches, outputOptions));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
