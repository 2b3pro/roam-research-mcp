import { Command } from 'commander';
import { SearchOperations } from '../../tools/operations/search/index.js';
import { printDebug, exitWithError } from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';

interface RefsOptions extends GraphOptions {
  limit?: string;
  json?: boolean;
  raw?: boolean;
  debug?: boolean;
}

interface RefMatch {
  block_uid: string;
  content: string;
  page_title?: string;
}

/**
 * Format results grouped by page (default output)
 */
function formatGrouped(matches: RefMatch[], maxContentLength: number = 60): string {
  if (matches.length === 0) {
    return 'No references found.';
  }

  // Group by page title
  const byPage = new Map<string, RefMatch[]>();
  for (const match of matches) {
    const pageTitle = match.page_title || 'Unknown Page';
    if (!byPage.has(pageTitle)) {
      byPage.set(pageTitle, []);
    }
    byPage.get(pageTitle)!.push(match);
  }

  // Format output
  const lines: string[] = [];
  for (const [pageTitle, pageMatches] of byPage) {
    lines.push(`[[${pageTitle}]]`);
    for (const match of pageMatches) {
      const truncated = match.content.length > maxContentLength
        ? match.content.slice(0, maxContentLength) + '...'
        : match.content;
      lines.push(`  ${match.block_uid}   ${truncated}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Format results as raw lines (UID + content)
 */
function formatRaw(matches: RefMatch[], maxContentLength: number = 60): string {
  if (matches.length === 0) {
    return 'No references found.';
  }

  return matches
    .map(match => {
      const truncated = match.content.length > maxContentLength
        ? match.content.slice(0, maxContentLength) + '...'
        : match.content;
      return `${match.block_uid}   ${truncated}`;
    })
    .join('\n');
}

/**
 * Parse identifier to determine if it's a block UID or page title
 */
function parseIdentifier(identifier: string): { block_uid?: string; title?: string } {
  // Check for ((uid)) format
  const blockRefMatch = identifier.match(/^\(\(([^)]+)\)\)$/);
  if (blockRefMatch) {
    return { block_uid: blockRefMatch[1] };
  }

  // Check for [[page]] or #[[page]] format - extract page title
  const pageRefMatch = identifier.match(/^#?\[\[(.+)\]\]$/);
  if (pageRefMatch) {
    return { title: pageRefMatch[1] };
  }

  // Check for #tag format
  if (identifier.startsWith('#')) {
    return { title: identifier.slice(1) };
  }

  // Default: treat as page title
  return { title: identifier };
}

export function createRefsCommand(): Command {
  return new Command('refs')
    .description('Find blocks referencing a page or block')
    .argument('<identifier>', 'Page title or block UID (use ((uid)) for block refs)')
    .option('-n, --limit <n>', 'Limit number of results', '50')
    .option('--json', 'Output as JSON array')
    .option('--raw', 'Output raw UID + content lines (no grouping)')
    .option('--debug', 'Show query metadata')
    .option('-g, --graph <name>', 'Target graph key (for multi-graph mode)')
    .action(async (identifier: string, options: RefsOptions) => {
      try {
        const graph = resolveGraph(options, false);

        const limit = parseInt(options.limit || '50', 10);
        const { block_uid, title } = parseIdentifier(identifier);

        if (options.debug) {
          printDebug('Identifier', identifier);
          printDebug('Graph', options.graph || 'default');
          printDebug('Parsed', { block_uid, title });
          printDebug('Options', options);
        }

        const searchOps = new SearchOperations(graph);
        const result = await searchOps.searchBlockRefs({ block_uid, title });

        if (options.debug) {
          printDebug('Total matches', result.matches.length);
        }

        // Apply limit
        const limitedMatches = result.matches.slice(0, limit);

        // Format output
        if (options.json) {
          const jsonOutput = limitedMatches.map(m => ({
            uid: m.block_uid,
            content: m.content,
            page: m.page_title
          }));
          console.log(JSON.stringify(jsonOutput, null, 2));
        } else if (options.raw) {
          console.log(formatRaw(limitedMatches));
        } else {
          console.log(formatGrouped(limitedMatches));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
