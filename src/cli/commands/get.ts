import { Command } from 'commander';
import { PageOperations } from '../../tools/operations/pages.js';
import { BlockRetrievalOperations } from '../../tools/operations/block-retrieval.js';
import { SearchOperations } from '../../tools/operations/search/index.js';
import {
  formatPageOutput,
  formatBlockOutput,
  formatTodoOutput,
  printDebug,
  exitWithError,
  type OutputOptions
} from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';
import type { RoamBlock } from '../../types/roam.js';

// Block UID pattern: 9 alphanumeric characters, optionally wrapped in (( ))
const BLOCK_UID_PATTERN = /^(?:\(\()?([a-zA-Z0-9_-]{9})(?:\)\))?$/;

interface GetOptions extends GraphOptions {
  json?: boolean;
  depth?: string;
  refs?: string;
  flat?: boolean;
  debug?: boolean;
  todo?: boolean;
  done?: boolean;
  page?: string;
  include?: string;
  exclude?: string;
}

export function createGetCommand(): Command {
  return new Command('get')
    .description('Fetch a page, block, or TODO/DONE items from Roam')
    .argument('[target]', 'Page title or block UID (e.g., "Page Title" or "((AbCdEfGhI))")')
    .option('--json', 'Output as JSON instead of markdown')
    .option('--depth <n>', 'Child levels to fetch (default: 4)', '4')
    .option('--refs <n>', 'Block ref expansion depth (default: 1)', '1')
    .option('--flat', 'Flatten hierarchy to single-level list')
    .option('--debug', 'Show query metadata')
    .option('--todo', 'Fetch TODO items')
    .option('--done', 'Fetch DONE items')
    .option('-p, --page <title>', 'Filter TODOs/DONEs by page title')
    .option('-i, --include <terms>', 'Include items with these terms in text content (comma-separated, not tags)')
    .option('-e, --exclude <terms>', 'Exclude items with these terms in text content (comma-separated, not tags)')
    .option('-g, --graph <name>', 'Target graph key (for multi-graph mode)')
    .action(async (target: string | undefined, options: GetOptions) => {
      try {
        const graph = resolveGraph(options, false);

        const depth = parseInt(options.depth || '4', 10);
        const outputOptions: OutputOptions = {
          json: options.json,
          flat: options.flat,
          debug: options.debug
        };

        if (options.debug) {
          printDebug('Target', target);
          printDebug('Graph', options.graph || 'default');
          printDebug('Options', { depth, refs: options.refs, ...outputOptions });
        }

        // Handle --todo or --done flags
        if (options.todo || options.done) {
          const status = options.todo ? 'TODO' : 'DONE';

          if (options.debug) {
            printDebug('Status search', { status, page: options.page, include: options.include, exclude: options.exclude });
          }

          const searchOps = new SearchOperations(graph);
          const result = await searchOps.searchByStatus(
            status,
            options.page,
            options.include,
            options.exclude
          );

          console.log(formatTodoOutput(result.matches, status, outputOptions));
          return;
        }

        // For page/block fetching, target is required
        if (!target) {
          exitWithError('Target is required. Use: roam get <page-title> or roam get --todo');
        }

        // Check if target is a block UID
        const uidMatch = target.match(BLOCK_UID_PATTERN);

        if (uidMatch) {
          // Fetch block by UID
          const blockUid = uidMatch[1];

          if (options.debug) {
            printDebug('Fetching block', { uid: blockUid, depth });
          }

          const blockOps = new BlockRetrievalOperations(graph);
          const block = await blockOps.fetchBlockWithChildren(blockUid, depth);

          if (!block) {
            exitWithError(`Block with UID "${blockUid}" not found`);
          }

          console.log(formatBlockOutput(block, outputOptions));
        } else {
          // Fetch page by title
          if (options.debug) {
            printDebug('Fetching page', { title: target, depth });
          }

          const pageOps = new PageOperations(graph);
          const result = await pageOps.fetchPageByTitle(target, 'raw');

          // Parse the raw result
          let blocks: RoamBlock[];
          if (typeof result === 'string') {
            try {
              blocks = JSON.parse(result) as RoamBlock[];
            } catch {
              // Result is already formatted as string (e.g., "Page Title (no content found)")
              console.log(result);
              return;
            }
          } else {
            blocks = result;
          }

          console.log(formatPageOutput(target, blocks, outputOptions));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
