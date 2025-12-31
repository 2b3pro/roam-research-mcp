import type { RoamBlock } from '../../types/roam.js';

export interface OutputOptions {
  json?: boolean;
  flat?: boolean;
  debug?: boolean;
}

/**
 * Convert RoamBlock hierarchy to markdown with proper indentation
 */
export function blocksToMarkdown(blocks: RoamBlock[], level: number = 0): string {
  return blocks
    .map(block => {
      const indent = '  '.repeat(level);
      let md: string;

      // Check block heading level and format accordingly
      if (block.heading && block.heading > 0) {
        const hashtags = '#'.repeat(block.heading);
        md = `${indent}${hashtags} ${block.string}`;
      } else {
        md = `${indent}- ${block.string}`;
      }

      if (block.children && block.children.length > 0) {
        md += '\n' + blocksToMarkdown(block.children, level + 1);
      }
      return md;
    })
    .join('\n');
}

/**
 * Flatten block hierarchy to single-level list
 */
export function flattenBlocks(blocks: RoamBlock[], result: RoamBlock[] = []): RoamBlock[] {
  for (const block of blocks) {
    result.push({ ...block, children: [] });
    if (block.children && block.children.length > 0) {
      flattenBlocks(block.children, result);
    }
  }
  return result;
}

/**
 * Format page content for output
 */
export function formatPageOutput(
  title: string,
  blocks: RoamBlock[],
  options: OutputOptions
): string {
  if (options.json) {
    const data = options.flat ? flattenBlocks(blocks) : blocks;
    return JSON.stringify({ title, children: data }, null, 2);
  }

  const displayBlocks = options.flat ? flattenBlocks(blocks) : blocks;
  return `# ${title}\n\n${blocksToMarkdown(displayBlocks)}`;
}

/**
 * Format block content for output
 */
export function formatBlockOutput(
  block: RoamBlock,
  options: OutputOptions
): string {
  if (options.json) {
    const data = options.flat ? flattenBlocks([block]) : block;
    return JSON.stringify(data, null, 2);
  }

  const displayBlocks = options.flat ? flattenBlocks([block]) : [block];
  return blocksToMarkdown(displayBlocks);
}

/**
 * Format search results for output
 */
export function formatSearchResults(
  results: Array<{ block_uid: string; content: string; page_title?: string }>,
  options: OutputOptions
): string {
  if (options.json) {
    return JSON.stringify(results, null, 2);
  }

  if (results.length === 0) {
    return 'No results found.';
  }

  let output = `Found ${results.length} result(s):\n\n`;

  results.forEach((result, index) => {
    const pageInfo = result.page_title ? ` (${result.page_title})` : '';
    output += `[${index + 1}] ${result.block_uid}${pageInfo}\n`;
    output += `    ${result.content}\n\n`;
  });

  return output.trim();
}

/**
 * Print debug information
 */
export function printDebug(label: string, data: unknown): void {
  console.error(`[DEBUG] ${label}:`, JSON.stringify(data, null, 2));
}

/**
 * Print error message and exit
 */
export function exitWithError(message: string, code: number = 1): never {
  console.error(`Error: ${message}`);
  process.exit(code);
}
