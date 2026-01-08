import { Command } from 'commander';
import { PageOperations } from '../../tools/operations/pages.js';
import { BlockRetrievalOperations } from '../../tools/operations/block-retrieval.js';
import { SearchOperations } from '../../tools/operations/search/index.js';
import {
  formatPageOutput,
  formatBlockOutput,
  formatTodoOutput,
  formatGroupedOutput,
  flattenBlocks,
  blocksToMarkdown,
  printDebug,
  exitWithError,
  type OutputOptions
} from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';
import { readStdin } from '../utils/input.js';
import { resolveRefs } from '../../tools/helpers/refs.js';
import { resolveRelativeDate } from '../../utils/helpers.js';
import { SearchUtils } from '../../search/utils.js';
import {
  sortResults,
  groupResults,
  getDefaultDirection,
  type SortField,
  type SortDirection,
  type GroupByField
} from '../utils/sort-group.js';
import type { SearchMatch } from '../../search/types.js';
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
  tag?: string[];
  text?: string;
  any?: boolean;
  negtag?: string[];
  limit?: string;
  showall?: boolean;
  sort?: string;
  asc?: boolean;
  desc?: boolean;
  groupBy?: string;
}

/**
 * Recursively resolve block references in a RoamBlock tree
 */
async function resolveBlockRefsInTree(graph: Graph, block: RoamBlock, maxDepth: number): Promise<RoamBlock> {
  // Only resolve if string is valid
  const resolvedString = typeof block.string === 'string'
    ? await resolveRefs(graph, block.string, 0, maxDepth)
    : block.string || '';
  const resolvedChildren = await Promise.all(
    (block.children || []).map(child => resolveBlockRefsInTree(graph, child, maxDepth))
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
async function resolveBlocksRefsInTree(graph: Graph, blocks: RoamBlock[], maxDepth: number): Promise<RoamBlock[]> {
  return Promise.all(blocks.map(block => resolveBlockRefsInTree(graph, block, maxDepth)));
}

/**
 * Normalize a tag by stripping #, [[, ]] wrappers
 */
function normalizeTag(tag: string): string {
  return tag.replace(/^#?\[?\[?/, '').replace(/\]?\]?$/, '');
}

/**
 * Check if content contains a tag (handles #tag, [[tag]], #[[tag]] formats)
 * Case-insensitive matching.
 */
function contentHasTag(content: string, tag: string): boolean {
  const normalized = normalizeTag(tag).toLowerCase();
  const lowerContent = content.toLowerCase();
  return (
    lowerContent.includes(`[[${normalized}]]`) ||
    lowerContent.includes(`#${normalized}`) ||
    lowerContent.includes(`#[[${normalized}]]`)
  );
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
    .option('-p, --page <ref>', 'Scope to page title or UID (for TODOs, tags, text)')
    .option('-i, --include <terms>', 'Include items matching these terms (comma-separated)')
    .option('-e, --exclude <terms>', 'Exclude items matching these terms (comma-separated)')
    .option('--tag <tag>', 'Get blocks with tag (repeatable, comma-separated)', (val, prev: string[]) => {
      const tags = val.split(',').map(t => t.trim()).filter(Boolean);
      return prev ? [...prev, ...tags] : tags;
    }, [] as string[])
    .option('--text <text>', 'Get blocks containing text')
    .option('--any', 'Use OR logic for multiple tags (default is AND)')
    .option('--negtag <tag>', 'Exclude blocks with tag (repeatable, comma-separated)', (val, prev: string[]) => {
      const tags = val.split(',').map(t => t.trim()).filter(Boolean);
      return prev ? [...prev, ...tags] : tags;
    }, [] as string[])
    .option('-n, --limit <n>', 'Limit number of blocks fetched (default: 20 for tag/text)', '20')
    .option('--showall', 'Show all results (no limit)')
    .option('--sort <field>', 'Sort results by: created, modified, page')
    .option('--asc', 'Sort ascending (default for page)')
    .option('--desc', 'Sort descending (default for dates)')
    .option('--group-by <field>', 'Group results by: page, tag')
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

  # Tag-based retrieval (returns blocks with children)
  roam get --tag TODO                         # Blocks tagged with #TODO
  roam get --tag Project,Active              # Blocks with both tags (AND)
  roam get --tag Project --tag Active --any   # Blocks with either tag (OR)
  roam get --tag Task --negtag Done           # Tasks excluding Done
  roam get --tag Meeting -p "Work"            # Meetings on Work page

  # Text-based retrieval
  roam get --text "urgent"                    # Blocks containing "urgent"
  roam get --text "meeting" --tag Project     # Combine text + tag filter
  roam get --text "TODO" -p today             # Text search on today's page

  # Sorting
  roam get --tag Convention --sort created    # Sort by creation date (newest first)
  roam get --todo --sort modified --asc       # Sort by edit date (oldest first)
  roam get --tag Project --sort page          # Sort alphabetically by page

  # Grouping
  roam get --tag Convention --group-by page   # Group by source page
  roam get --tag Convention --group-by tag    # Group by subtags (Convention/*)

  # Combined
  roam get --tag Convention --group-by tag --sort modified

Output format:
  Markdown: Content with hierarchy (no UIDs). Use --json for UIDs.
  JSON:     Full block structure including uid field.

JSON output fields:
  Page:      { title, children: [Block...] }
  Block:     { uid, string, order, heading?, children: [Block...] }
  TODO/DONE: [{ block_uid, content, page_title }]
  Tag/Text:  [{ uid, string, order, heading?, children: [...] }]

Note: For flat results with UIDs, use 'roam search' instead.
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

        // Parse sort/group options
        const sortField = options.sort as SortField | undefined;
        const groupByField = options.groupBy as GroupByField | undefined;
        const sortDirection: SortDirection | undefined = sortField
          ? (options.asc ? 'asc' : options.desc ? 'desc' : getDefaultDirection(sortField))
          : undefined;

        // Handle --todo or --done flags (these ignore target arg usually, but could filter by page if target is used as page?)
        // The help says "-p" is for page. So we strictly follow flags.
        if (options.todo || options.done) {
          const status = options.todo ? 'TODO' : 'DONE';

          if (options.debug) {
            printDebug('Status search', { status, page: options.page, include: options.include, exclude: options.exclude });
            if (sortField) printDebug('Sort', { field: sortField, direction: sortDirection });
            if (groupByField) printDebug('Group by', groupByField);
          }

          const searchOps = new SearchOperations(graph);
          const result = await searchOps.searchByStatus(
            status,
            options.page,
            options.include,
            options.exclude
          );

          let matches: SearchMatch[] = result.matches;

          // Apply sorting
          if (sortField && sortDirection) {
            matches = sortResults(matches, { field: sortField, direction: sortDirection });
          }

          // Apply grouping
          if (groupByField) {
            // For TODO/DONE, only page grouping makes sense (no tags on search results)
            if (groupByField === 'tag') {
              exitWithError('--group-by tag is not supported for TODO/DONE search. Use --group-by page instead.');
            }
            const grouped = groupResults(matches, { by: groupByField });
            console.log(formatGroupedOutput(grouped, outputOptions));
          } else {
            console.log(formatTodoOutput(matches, status, outputOptions));
          }
          return;
        }

        // Handle --tag and/or --text flags (search-based retrieval with full children)
        const tags = options.tag || [];
        if (tags.length > 0 || options.text) {
          const searchOps = new SearchOperations(graph);
          const blockOps = new BlockRetrievalOperations(graph);
          const limit = options.showall ? Infinity : parseInt(options.limit || '20', 10);
          const useOrLogic = options.any || false;

          // Resolve page scope
          const pageScope = options.page ? resolveRelativeDate(options.page) : undefined;

          if (options.debug) {
            printDebug('Tag/Text search', {
              tags,
              text: options.text,
              page: pageScope,
              any: useOrLogic,
              negtag: options.negtag,
              limit
            });
            if (sortField) printDebug('Sort', { field: sortField, direction: sortDirection });
            if (groupByField) printDebug('Group by', groupByField);
          }

          // Get initial matches
          let matches: SearchMatch[] = [];

          if (options.text) {
            // Text search
            const result = await searchOps.searchByText({
              text: options.text,
              page_title_uid: pageScope
            });
            matches = result.matches;
          } else if (tags.length > 0) {
            // Tag search (use first tag as primary)
            const normalizedTags = tags.map(normalizeTag);
            const result = await searchOps.searchForTag(normalizedTags[0], pageScope);
            matches = result.matches;
          }

          // Apply additional tag filters
          if (tags.length > 0 && matches.length > 0) {
            const normalizedTags = tags.map(normalizeTag);

            // For text search with tags, filter by ALL tags
            // For tag search with multiple tags, filter by remaining tags based on --any
            if (options.text || normalizedTags.length > 1) {
              matches = matches.filter(m => {
                if (useOrLogic) {
                  return normalizedTags.some(tag => contentHasTag(m.content, tag));
                } else {
                  return normalizedTags.every(tag => contentHasTag(m.content, tag));
                }
              });
            }
          }

          // Apply negative tag filter
          const negTags = options.negtag || [];
          if (negTags.length > 0) {
            const normalizedNegTags = negTags.map(normalizeTag);
            matches = matches.filter(m =>
              !normalizedNegTags.some(tag => contentHasTag(m.content, tag))
            );
          }

          // Apply sorting before limit (so we get the top N sorted items)
          if (sortField && sortDirection) {
            matches = sortResults(matches, { field: sortField, direction: sortDirection });
          }

          // Apply limit
          const limitedMatches = matches.slice(0, limit);

          if (limitedMatches.length === 0) {
            console.log(options.json ? '[]' : 'No blocks found matching criteria.');
            return;
          }

          // For tag grouping, fetch all tags for matched blocks
          if (groupByField === 'tag') {
            const blockUids = limitedMatches.map(m => m.block_uid);
            const tagMap = await SearchUtils.fetchBlockTags(graph, blockUids);

            // Attach tags to matches
            for (const match of limitedMatches) {
              match.tags = tagMap.get(match.block_uid) || [];
            }

            // Group and output
            const primaryTag = tags.length > 0 ? normalizeTag(tags[0]) : '';
            const grouped = groupResults(limitedMatches, { by: 'tag', searchTag: primaryTag });
            console.log(formatGroupedOutput(grouped, outputOptions));
            return;
          }

          // For page grouping, output grouped matches
          if (groupByField === 'page') {
            const grouped = groupResults(limitedMatches, { by: 'page' });
            console.log(formatGroupedOutput(grouped, outputOptions));
            return;
          }

          // Standard output: fetch full blocks with children
          const blocks: RoamBlock[] = [];
          for (const match of limitedMatches) {
            let block = await blockOps.fetchBlockWithChildren(match.block_uid, depth);
            if (block) {
              // Resolve refs if requested (default: enabled for tag/text search)
              const effectiveRefsDepth = refsDepth > 0 ? refsDepth : 1;
              block = await resolveBlockRefsInTree(graph, block, effectiveRefsDepth);
              blocks.push(block);
            }
          }

          // Output
          if (options.json) {
            const data = options.flat
              ? blocks.flatMap(b => flattenBlocks([b]))
              : blocks;
            console.log(JSON.stringify(data, null, 2));
          } else {
            const displayBlocks = options.flat
              ? blocks.flatMap(b => flattenBlocks([b]))
              : blocks;

            // Show count header
            const countMsg = matches.length > limit
              ? `Found ${matches.length} blocks (showing first ${limit}):\n\n`
              : `Found ${blocks.length} block(s):\n\n`;
            console.log(countMsg + blocksToMarkdown(displayBlocks));
          }
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
             exitWithError('Target is required. Use: roam get <page-title>, roam get --todo, roam get --tag <tag>, roam get --text <text>, or pipe targets via stdin');
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
               block = await resolveBlockRefsInTree(graph, block, refsDepth);
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
               blocks = await resolveBlocksRefsInTree(graph, blocks, refsDepth);
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
