import { Command } from 'commander';
import { initializeGraph } from '@roam-research/roam-api-sdk';
import { API_TOKEN, GRAPH_NAME } from '../../config/environment.js';
import { SearchOperations } from '../../tools/operations/search/index.js';
import {
  formatSearchResults,
  printDebug,
  exitWithError,
  type OutputOptions
} from '../utils/output.js';

interface SearchOptions {
  tag?: string;
  page?: string;
  caseInsensitive?: boolean;
  limit?: string;
  json?: boolean;
  debug?: boolean;
}

export function createSearchCommand(): Command {
  return new Command('search')
    .description('Search for content in Roam')
    .argument('[terms...]', 'Search terms (multiple terms use AND logic)')
    .option('--tag <tag>', 'Filter by tag (e.g., "#TODO" or "[[Project]]")')
    .option('--page <title>', 'Scope search to a specific page')
    .option('-i, --case-insensitive', 'Case-insensitive search')
    .option('-n, --limit <n>', 'Limit number of results (default: 20)', '20')
    .option('--json', 'Output as JSON')
    .option('--debug', 'Show query metadata')
    .action(async (terms: string[], options: SearchOptions) => {
      try {
        const graph = initializeGraph({
          token: API_TOKEN,
          graph: GRAPH_NAME
        });

        const limit = parseInt(options.limit || '20', 10);
        const outputOptions: OutputOptions = {
          json: options.json,
          debug: options.debug
        };

        if (options.debug) {
          printDebug('Search terms', terms);
          printDebug('Options', options);
        }

        const searchOps = new SearchOperations(graph);

        // Determine search type based on options
        if (options.tag && terms.length === 0) {
          // Tag-only search
          const tagName = options.tag.replace(/^#?\[?\[?/, '').replace(/\]?\]?$/, '');

          if (options.debug) {
            printDebug('Tag search', { tag: tagName, page: options.page });
          }

          const result = await searchOps.searchForTag(tagName, options.page);

          const limitedMatches = result.matches.slice(0, limit);
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
          if (options.tag) {
            const tagPattern = options.tag.replace(/^#?\[?\[?/, '').replace(/\]?\]?$/, '');
            matches = matches.filter(m =>
              m.content.includes(`[[${tagPattern}]]`) ||
              m.content.includes(`#${tagPattern}`) ||
              m.content.includes(`#[[${tagPattern}]]`)
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
