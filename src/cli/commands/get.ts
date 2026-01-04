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
import { resolveRefs } from '../../tools/helpers/refs.js';
import { resolveRelativeDate } from '../../utils/helpers.js';
import type { RoamBlock } from '../../types/roam.js';
import type { Graph } from '@roam-research/roam-api-sdk';

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

/**
 * Recursively resolve block references in a RoamBlock tree
 */
async function resolveBlockRefs(graph: Graph, block: RoamBlock, maxDepth: number): Promise<RoamBlock> {
  const resolvedString = await resolveRefs(graph, block.string, 0, maxDepth);
  const resolvedChildren = await Promise.all(
    (block.children || []).map(child => resolveBlockRefs(graph, child, maxDepth))
  );
  return {
    ...block,
    string: resolvedString,
    children: resolvedChildren
  };
}

/**
 * Resolve refs in an array of blocks
 */
async function resolveBlocksRefs(graph: Graph, blocks: RoamBlock[], maxDepth: number): Promise<RoamBlock[]> {
  return Promise.all(blocks.map(block => resolveBlockRefs(graph, block, maxDepth)));
}

export function createGetCommand(): Command {
  return new Command('get')
    .description('Fetch pages, blocks, or TODO/DONE items with optional ref expansion')
    .argument('[target]', 'Page title, block UID, or relative date (today/yesterday/tomorrow)')
    .option('-j, --json', 'Output as JSON instead of markdown')
    .option('-d, --depth <n>', 'Child levels to fetch (default: 4)', '4')
    .option('-r, --refs [n]', 'Expand ((uid)) refs in output (default depth: 1, max: 4)')
    .option('-f, --flat', 'Flatten hierarchy to single-level list')
    .option('--todo', 'Fetch TODO items')
    .option('--done', 'Fetch DONE items')
    .option('-p, --page <ref>', 'Filter TODOs/DONEs by page title or UID')
    .option('-i, --include <terms>', 'Include items matching these terms (comma-separated)')
    .option('-e, --exclude <terms>', 'Exclude items matching these terms (comma-separated)')
    .option('-g, --graph <name>', 'Target graph key (multi-graph mode)')
    .option('--debug', 'Show query metadata')
    .addHelpText('after', `
Examples:
  # Fetch pages
  roam get "Project Notes"                    # Page by title
  roam get today                              # Today's daily page
  roam get yesterday                          # Yesterday's daily page
  roam get tomorrow                           # Tomorrow's daily page

  # Fetch blocks
  roam get abc123def                          # Block by UID
  roam get "((abc123def))"                    # UID with wrapper

  # Output options
  roam get "Page" -j                          # JSON output
  roam get "Page" -f                          # Flat list (no hierarchy)
  roam get abc123def -d 2                     # Limit depth to 2 levels
  roam get "Page" -r                          # Expand block refs (depth 1)
  roam get "Page" -r 3                        # Expand refs up to 3 levels deep

  # TODO/DONE items (refs auto-expanded)
  roam get --todo                             # All TODOs across graph
  roam get --done                             # All completed items
  roam get --todo -p "Work"                   # TODOs on "Work" page
  roam get --todo -i "urgent,blocker"         # TODOs containing these terms
  roam get --todo -e "someday,maybe"          # Exclude items with terms
`)
    .action(async (target: string | undefined, options: GetOptions) => {
      try {
        const graph = resolveGraph(options, false);

        const depth = parseInt(options.depth || '4', 10);
        // Parse refs: true/string means enabled, number sets max depth (default 1, max 4)
        const refsDepth = options.refs !== undefined
          ? Math.min(4, Math.max(1, parseInt(options.refs as string, 10) || 1))
          : 0;
        const outputOptions: OutputOptions = {
          json: options.json,
          flat: options.flat,
          debug: options.debug
        };

        if (options.debug) {
          printDebug('Target', target);
          printDebug('Graph', options.graph || 'default');
          printDebug('Options', { depth, refs: refsDepth || 'off', ...outputOptions });
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

        // Resolve relative date keywords (today, yesterday, tomorrow)
        const resolvedTarget = resolveRelativeDate(target);

        if (options.debug && resolvedTarget !== target) {
          printDebug('Resolved date', `${target} → ${resolvedTarget}`);
        }

        // Check if target is a block UID
        const uidMatch = resolvedTarget.match(BLOCK_UID_PATTERN);

        if (uidMatch) {
          // Fetch block by UID
          const blockUid = uidMatch[1];

          if (options.debug) {
            printDebug('Fetching block', { uid: blockUid, depth });
          }

          const blockOps = new BlockRetrievalOperations(graph);
          let block = await blockOps.fetchBlockWithChildren(blockUid, depth);

          if (!block) {
            exitWithError(`Block with UID "${blockUid}" not found`);
          }

          // Resolve block references if requested
          if (refsDepth > 0) {
            block = await resolveBlockRefs(graph, block, refsDepth);
          }

          console.log(formatBlockOutput(block, outputOptions));
        } else {
          // Fetch page by title
          if (options.debug) {
            printDebug('Fetching page', { title: resolvedTarget, depth });
          }

          const pageOps = new PageOperations(graph);
          const result = await pageOps.fetchPageByTitle(resolvedTarget, 'raw');

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

          // Resolve block references if requested
          if (refsDepth > 0) {
            blocks = await resolveBlocksRefs(graph, blocks, refsDepth);
          }

          console.log(formatPageOutput(resolvedTarget, blocks, outputOptions));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
