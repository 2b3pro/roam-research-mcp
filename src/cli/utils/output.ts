import type { RoamBlock } from '../../types/roam.js';
import type { GroupedResults } from './sort-group.js';

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

  results.forEach((result) => {
    const pageInfo = result.page_title ? ` — [[${result.page_title}]]` : '';
    output += `[${result.block_uid}] ${result.content}${pageInfo}\n`;
  });

  return output.trim();
}

/**
 * Format TODO/DONE search results for output
 */
export function formatTodoOutput(
  results: Array<{ block_uid: string; content: string; page_title?: string }>,
  status: 'TODO' | 'DONE',
  options: OutputOptions
): string {
  if (options.json) {
    return JSON.stringify(results, null, 2);
  }

  if (results.length === 0) {
    return `No ${status} items found.`;
  }

  // Group by page
  const byPage = new Map<string, typeof results>();
  for (const item of results) {
    const page = item.page_title || 'Unknown Page';
    if (!byPage.has(page)) {
      byPage.set(page, []);
    }
    byPage.get(page)!.push(item);
  }

  let output = `Found ${results.length} ${status} item(s):\n`;

  for (const [page, items] of byPage) {
    output += `\n## ${page}\n`;
    for (const item of items) {
      // Strip {{[[TODO]]}}, {{TODO}}, {{[[DONE]]}}, or {{DONE}} markers for cleaner display
      const cleanContent = item.content
        .replace(/\{\{\[\[TODO\]\]\}\}\s*/g, '')
        .replace(/\{\{TODO\}\}\s*/g, '')
        .replace(/\{\{\[\[DONE\]\]\}\}\s*/g, '')
        .replace(/\{\{DONE\}\}\s*/g, '');
      output += `[${item.block_uid}] [${status === 'DONE' ? 'x' : ' '}] ${cleanContent}\n`;
    }
  }

  return output.trim();
}

/**
 * Format grouped search results for output
 */
export function formatGroupedOutput(
  grouped: GroupedResults,
  options: OutputOptions
): string {
  if (options.json) {
    return JSON.stringify(grouped, null, 2);
  }

  const { groups, meta } = grouped;
  const groupKeys = Object.keys(groups);

  if (groupKeys.length === 0) {
    return 'No results found.';
  }

  let output = `Found ${meta.total} item(s) in ${meta.groups_count} group(s):\n`;

  for (const groupName of groupKeys) {
    const items = groups[groupName];
    output += `\n## ${groupName}\n`;

    for (const item of items) {
      // Format: [uid] content with optional page reference
      const pageRef = item.page_title ? ` — [[${item.page_title}]]` : '';
      output += `[${item.block_uid}] ${item.content}${pageRef}\n`;
    }
  }

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
