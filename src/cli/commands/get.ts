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
import { readStdin } from '../utils/input.js';
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
    .argument('[target]', 'Page title, block UID, or relative date. Reads from stdin if "-" or omitted.')
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

  # Fetch blocks
  roam get abc123def                          # Block by UID
  roam get "((abc123def))"                    # UID with wrapper

  # Stdin / Batch Retrieval
  echo "Project A" | roam get                 # Pipe page title
  echo "abc123def" | roam get                 # Pipe block UID
  cat uids.txt | roam get --json              # Fetch multiple blocks (NDJSON output)

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

JSON output fields:
  Page:      { title, children: [Block...] }
  Block:     { uid, string, order, heading?, children: [Block...] }
  TODO/DONE: [{ block_uid, content, page_title }]
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
          printDebug('Target', target || 'stdin');
          printDebug('Graph', options.graph || 'default');
          printDebug('Options', { depth, refs: refsDepth || 'off', ...outputOptions });
        }

        // Handle --todo or --done flags (these ignore target arg usually, but could filter by page if target is used as page?)
        // The help says "-p" is for page. So we strictly follow flags.
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

        // Determine targets
        let targets: string[] = [];
        if (target && target !== '-') {
          targets = [target];
        } else {
          // Read from stdin if no target or explicit '-'
          if (process.stdin.isTTY && target !== '-') {
             // If TTY and no target, show error
             exitWithError('Target is required. Use: roam get <page-title>, roam get --todo, or pipe targets via stdin');
          }
          const input = await readStdin();
          if (input) {
            targets = input.split('\n').map(t => t.trim()).filter(Boolean);
          }
        }

        if (targets.length === 0) {
          exitWithError('No targets provided');
        }

        // Helper to process a single target
        const processTarget = async (item: string) => {
           // Resolve relative date keywords (today, yesterday, tomorrow)
           const resolvedTarget = resolveRelativeDate(item);
           
           if (options.debug && resolvedTarget !== item) {
             printDebug('Resolved date', `${item} → ${resolvedTarget}`);
           }

           // Check if target is a block UID
           const uidMatch = resolvedTarget.match(BLOCK_UID_PATTERN);

           if (uidMatch) {
             // Fetch block by UID
             const blockUid = uidMatch[1];
             if (options.debug) printDebug('Fetching block', { uid: blockUid });

             const blockOps = new BlockRetrievalOperations(graph);
             let block = await blockOps.fetchBlockWithChildren(blockUid, depth);

             if (!block) {
               // If fetching multiple, maybe warn instead of exit?
               // For now, consistent behavior: print error message to stderr but continue?
               // Or simpler: just return a "not found" string/object.
               // formatBlockOutput doesn't handle null.
               return options.json ? JSON.stringify({ error: `Block ${blockUid} not found` }) : `Block ${blockUid} not found`;
             }

             // Resolve block references if requested
             if (refsDepth > 0) {
               block = await resolveBlockRefs(graph, block, refsDepth);
             }

             return formatBlockOutput(block, outputOptions);
           } else {
             // Fetch page by title
             if (options.debug) printDebug('Fetching page', { title: resolvedTarget });

             const pageOps = new PageOperations(graph);
             const result = await pageOps.fetchPageByTitle(resolvedTarget, 'raw');

             // Parse the raw result
             let blocks: RoamBlock[];
             if (typeof result === 'string') {
               try {
                 blocks = JSON.parse(result) as RoamBlock[];
               } catch {
                 // Result is already formatted as string (e.g., "Page Title (no content found)")
                 // But wait, fetchPageByTitle returns string if not found or empty?
                 // Actually fetchPageByTitle 'raw' returns JSON string of blocks OR empty array JSON string?
                 // Let's assume result is valid JSON or error message string.
                 return options.json ? JSON.stringify({ title: resolvedTarget, error: result }) : result;
               }
             } else {
               blocks = result;
             }

             // Resolve block references if requested
             if (refsDepth > 0) {
               blocks = await resolveBlocksRefs(graph, blocks, refsDepth);
             }

             return formatPageOutput(resolvedTarget, blocks, outputOptions);
           }
        };

        // Execute sequentially
        for (const t of targets) {
           const output = await processTarget(t);
           console.log(output);
        }

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
