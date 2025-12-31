import { Command } from 'commander';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { initializeGraph } from '@roam-research/roam-api-sdk';
import { API_TOKEN, GRAPH_NAME } from '../../config/environment.js';
import { PageOperations } from '../../tools/operations/pages.js';
import { parseMarkdown } from '../../markdown-utils.js';
import { printDebug, exitWithError } from '../utils/output.js';

interface MarkdownNode {
  content: string;
  level: number;
  heading_level?: number;
  children: MarkdownNode[];
}

/**
 * Flatten nested MarkdownNode[] to flat array with absolute levels
 */
function flattenNodes(
  nodes: MarkdownNode[],
  baseLevel: number = 1
): Array<{ text: string; level: number; heading?: number }> {
  const result: Array<{ text: string; level: number; heading?: number }> = [];

  for (const node of nodes) {
    result.push({
      text: node.content,
      level: baseLevel,
      ...(node.heading_level && { heading: node.heading_level })
    });

    if (node.children.length > 0) {
      result.push(...flattenNodes(node.children, baseLevel + 1));
    }
  }

  return result;
}

/**
 * Read all input from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

interface SaveOptions {
  title?: string;
  update?: boolean;
  debug?: boolean;
}

export function createSaveCommand(): Command {
  return new Command('save')
    .description('Import markdown to Roam')
    .argument('[file]', 'Markdown file to import (or pipe content to stdin)')
    .option('--title <title>', 'Page title (defaults to filename without .md)')
    .option('--update', 'Update existing page using smart diff')
    .option('--debug', 'Show debug information')
    .action(async (file: string | undefined, options: SaveOptions) => {
      try {
        let markdownContent: string;
        let pageTitle: string;

        if (file) {
          // Read from file
          try {
            markdownContent = readFileSync(file, 'utf-8');
          } catch (err) {
            exitWithError(`Could not read file: ${file}`);
          }

          // Derive title from filename if not provided
          pageTitle = options.title || basename(file, '.md');
        } else {
          // Read from stdin
          if (process.stdin.isTTY) {
            exitWithError('No file specified and no input piped. Use: roam save <file.md> or cat file.md | roam save --title "Title"');
          }

          if (!options.title) {
            exitWithError('--title is required when piping from stdin');
          }

          markdownContent = await readStdin();
          pageTitle = options.title;
        }

        if (!markdownContent.trim()) {
          exitWithError('Empty content received');
        }

        if (options.debug) {
          printDebug('Page title', pageTitle);
          printDebug('Content length', markdownContent.length);
          printDebug('Update mode', options.update || false);
        }

        const graph = initializeGraph({
          token: API_TOKEN,
          graph: GRAPH_NAME
        });

        const pageOps = new PageOperations(graph);

        if (options.update) {
          // Use smart diff to update existing page
          const result = await pageOps.updatePageMarkdown(
            pageTitle,
            markdownContent,
            false // not dry run
          );

          if (result.success) {
            console.log(`Updated page '${pageTitle}'`);
            console.log(`  ${result.summary}`);
            if (result.preservedUids.length > 0) {
              console.log(`  Preserved ${result.preservedUids.length} block UID(s)`);
            }
          } else {
            exitWithError(`Failed to update page '${pageTitle}'`);
          }
        } else {
          // Create new page (or add content to existing empty page)
          const nodes = parseMarkdown(markdownContent) as MarkdownNode[];
          const contentBlocks = flattenNodes(nodes);

          if (contentBlocks.length === 0) {
            exitWithError('No content blocks parsed from input');
          }

          if (options.debug) {
            printDebug('Parsed blocks', contentBlocks.length);
          }

          const result = await pageOps.createPage(pageTitle, contentBlocks);

          if (result.success) {
            console.log(`Created page '${pageTitle}' (uid: ${result.uid})`);
          } else {
            exitWithError(`Failed to create page '${pageTitle}'`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
