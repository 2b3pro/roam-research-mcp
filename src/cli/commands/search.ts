import { Command } from 'commander';
import { SearchOperations } from '../../tools/operations/search/index.js';
import {
  formatSearchResults,
  printDebug,
  exitWithError,
  type OutputOptions
} from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';

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
  return (
    content.includes(`[[${normalized}]]`) ||
    content.includes(`#${normalized}`) ||
    content.includes(`#[[${normalized}]]`)
  );
}

interface SearchOptions extends GraphOptions {
  tag?: string[];
  negtag?: string[];
  page?: string;
  caseInsensitive?: boolean;
  limit?: string;
  json?: boolean;
  debug?: boolean;
  query?: string;
  inputs?: string;
  regex?: string;
  regexFlags?: string;
  any?: boolean;
}

export function createSearchCommand(): Command {
  return new Command('search')
    .description('Search blocks by text, tags, Datalog queries, or within specific pages')
    .argument('[terms...]', 'Search terms (multiple terms use AND logic)')
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
    .option('-n, --limit <n>', 'Limit number of results (default: 20)', '20')
    .option('--json', 'Output as JSON')
    .option('--debug', 'Show query metadata')
    .option('-g, --graph <name>', 'Target graph key (for multi-graph mode)')
    .option('-q, --query <datalog>', 'Raw Datalog query (bypasses other search options)')
    .option('--inputs <json>', 'JSON array of inputs for Datalog query')
    .option('--regex <pattern>', 'Client-side regex filter on Datalog results')
    .option('--regex-flags <flags>', 'Regex flags (e.g., "i" for case-insensitive)')
    .addHelpText('after', `
Examples:
  # Text search
  roam search "meeting notes"               # Find blocks containing text
  roam search api integration               # Multiple terms (AND logic)
  roam search "bug fix" -i                  # Case-insensitive search

  # Tag search
  roam search --tag TODO                    # All blocks with #TODO
  roam search --tag "[[Project Alpha]]"     # Blocks with page reference
  roam search --tag work --page "January 3rd, 2026"  # Tag on specific page

  # Multiple tags
  roam search --tag TODO --tag urgent       # Blocks with BOTH tags (AND)
  roam search --tag "TODO,urgent,blocked"   # Comma-separated (AND)
  roam search --tag TODO --tag urgent --any # Blocks with ANY tag (OR)

  # Exclude tags
  roam search --tag TODO --negtag done      # TODOs excluding #done
  roam search --tag TODO --negtag "someday,maybe"  # Exclude multiple

  # Combined filters
  roam search urgent --tag TODO             # Text + tag filter
  roam search "review" --page "Work"        # Search within page

  # Output options
  roam search "design" -n 50                # Limit to 50 results
  roam search "api" --json                  # JSON output

  # Datalog queries (advanced)
  roam search -q '[:find ?title :where [?e :node/title ?title]]'
  roam search -q '[:find ?s :in $ ?term :where [?b :block/string ?s] [(clojure.string/includes? ?s ?term)]]' --inputs '["TODO"]'
  roam search -q '[:find ?uid ?s :where [?b :block/uid ?uid] [?b :block/string ?s]]' --regex "meeting" --regex-flags "i"

Datalog tips:
  Common attributes: :node/title, :block/string, :block/uid, :block/page, :block/children
  Predicates: clojure.string/includes?, clojure.string/starts-with?, <, >, =
`)
    .action(async (terms: string[], options: SearchOptions) => {
      try {
        const graph = resolveGraph(options, false);

        const limit = parseInt(options.limit || '20', 10);
        const outputOptions: OutputOptions = {
          json: options.json,
          debug: options.debug
        };

        if (options.debug) {
          printDebug('Search terms', terms);
          printDebug('Graph', options.graph || 'default');
          printDebug('Options', options);
        }

        const searchOps = new SearchOperations(graph);

        // Datalog query mode (bypasses other search options)
        // See for query construction - Roam_Research_Datalog_Cheatsheet.md
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

          if (options.debug) {
            printDebug('Datalog query', options.query);
            printDebug('Inputs', inputs || 'none');
            printDebug('Regex filter', options.regex || 'none');
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
          const limitedMatches = result.matches.slice(0, limit);

          if (options.json) {
            // For JSON output, parse the content back to objects
            const parsed = limitedMatches.map(m => {
              try {
                return JSON.parse(m.content);
              } catch {
                return m.content;
              }
            });
            console.log(JSON.stringify(parsed, null, 2));
          } else {
            // For text output, show raw results
            if (limitedMatches.length === 0) {
              console.log('No results found.');
            } else {
              console.log(`Found ${result.matches.length} results${result.matches.length > limit ? ` (showing first ${limit})` : ''}:\n`);
              for (const match of limitedMatches) {
                console.log(match.content);
              }
            }
          }
          return;
        }

        // Determine search type based on options
        const tags = options.tag || [];
        if (tags.length > 0 && terms.length === 0) {
          // Tag-only search
          const normalizedTags = tags.map(normalizeTag);
          const useOrLogic = options.any || false;

          if (options.debug) {
            printDebug('Tag search', {
              tags: normalizedTags,
              logic: useOrLogic ? 'OR' : 'AND',
              page: options.page
            });
          }

          // Search for first tag, then filter by additional tags
          const result = await searchOps.searchForTag(normalizedTags[0], options.page);

          let matches = result.matches;

          // Apply multi-tag filter if more than one tag
          if (normalizedTags.length > 1) {
            matches = matches.filter(m => {
              if (useOrLogic) {
                // OR: has at least one tag
                return normalizedTags.some(tag => contentHasTag(m.content, tag));
              } else {
                // AND: has all tags
                return normalizedTags.every(tag => contentHasTag(m.content, tag));
              }
            });
          }

          // Apply negtag filter (exclude blocks with any of these tags)
          const negTags = options.negtag || [];
          if (negTags.length > 0) {
            const normalizedNegTags = negTags.map(normalizeTag);
            matches = matches.filter(m =>
              !normalizedNegTags.some(tag => contentHasTag(m.content, tag))
            );
          }

          const limitedMatches = matches.slice(0, limit);
          console.log(formatSearchResults(limitedMatches, outputOptions));
        } else if (terms.length > 0) {
          // Text search (with optional tag filter)
          const searchText = terms.join(' ');

          if (options.debug) {
            printDebug('Text search', { text: searchText, page: options.page, tag: options.tag });
          }

          const result = await searchOps.searchByText({
            text: searchText,
            page_title_uid: options.page
          });

          // Apply client-side filters
          let matches = result.matches;

          // Case-insensitive filter if requested
          if (options.caseInsensitive) {
            const lowerSearchText = searchText.toLowerCase();
            matches = matches.filter(m =>
              m.content.toLowerCase().includes(lowerSearchText)
            );
          }

          // Tag filter if provided
          if (tags.length > 0) {
            const normalizedTags = tags.map(normalizeTag);
            const useOrLogic = options.any || false;

            matches = matches.filter(m => {
              if (useOrLogic) {
                return normalizedTags.some(tag => contentHasTag(m.content, tag));
              } else {
                return normalizedTags.every(tag => contentHasTag(m.content, tag));
              }
            });
          }

          // Negtag filter (exclude blocks with any of these tags)
          const negTags = options.negtag || [];
          if (negTags.length > 0) {
            const normalizedNegTags = negTags.map(normalizeTag);
            matches = matches.filter(m =>
              !normalizedNegTags.some(tag => contentHasTag(m.content, tag))
            );
          }

          // Apply limit
          console.log(formatSearchResults(matches.slice(0, limit), outputOptions));
        } else {
          exitWithError('Please provide search terms or use --tag to search by tag');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
