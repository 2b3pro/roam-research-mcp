import { Command } from 'commander';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { initializeGraph } from '@roam-research/roam-api-sdk';
import { API_TOKEN, GRAPH_NAME } from '../../config/environment.js';
import { PageOperations } from '../../tools/operations/pages.js';
import { MemoryOperations } from '../../tools/operations/memory.js';
import { TodoOperations } from '../../tools/operations/todos.js';
import { BatchOperations } from '../../tools/operations/batch.js';
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
  block?: string | boolean;  // Block content or flag for stdin
  page?: string;             // Target page for block (default: daily page)
  parent?: string;           // Parent block UID for nested block creation
  categories?: string;       // Comma-separated category tags
  todo?: string | boolean;   // TODO item text or flag for stdin
  json?: boolean;            // Input is JSON format (explicit levels)
}

interface ContentBlock {
  text: string;
  level: number;
  heading?: number;
}

export function createSaveCommand(): Command {
  return new Command('save')
    .description('Import content to Roam (page, block, or TODO). Supports markdown or JSON.')
    .argument('[file]', 'Markdown file to import (or pipe content to stdin)')
    .option('--title <title>', 'Page title (defaults to filename without .md)')
    .option('--update', 'Update existing page using smart diff')
    .option('--debug', 'Show debug information')
    .option('-b, --block [text]', 'Add a single block instead of a page (text or stdin)')
    .option('-p, --page <title>', 'Target page for block (default: today\'s daily page)')
    .option('--parent <uid>', 'Parent block UID for nested block creation (use with -b)')
    .option('-c, --categories <tags>', 'Comma-separated category tags for block mode')
    .option('-t, --todo [text]', 'Add a TODO item to today\'s daily page (text or stdin)')
    .option('--json', 'Input is JSON format with explicit levels [{text, level, heading?}]')
    .action(async (file: string | undefined, options: SaveOptions) => {
      try {
        // TODO mode: add a TODO item to today's daily page
        if (options.todo !== undefined) {
          let todoText: string;

          if (typeof options.todo === 'string' && options.todo.length > 0) {
            // TODO text provided directly
            todoText = options.todo;
          } else {
            // Read from stdin
            if (process.stdin.isTTY) {
              exitWithError('No TODO text specified. Use: roam save --todo "text" or echo "text" | roam save --todo');
            }
            todoText = (await readStdin()).trim();
          }

          if (!todoText) {
            exitWithError('Empty TODO text');
          }

          // Split by newlines to support multiple TODOs
          const todos = todoText.split('\n').map(t => t.trim()).filter(Boolean);

          if (options.debug) {
            printDebug('TODO mode', true);
            printDebug('TODO items', todos);
          }

          const graph = initializeGraph({
            token: API_TOKEN,
            graph: GRAPH_NAME
          });

          const todoOps = new TodoOperations(graph);
          const result = await todoOps.addTodos(todos);

          if (result.success) {
            console.log(`Added ${todos.length} TODO item(s) to today's daily page`);
          } else {
            exitWithError('Failed to save TODO');
          }
          return;
        }

        // Block mode: add a single block to a page
        if (options.block !== undefined) {
          let blockText: string;

          if (typeof options.block === 'string' && options.block.length > 0) {
            // Block text provided directly
            blockText = options.block;
          } else {
            // Read from stdin
            if (process.stdin.isTTY) {
              exitWithError('No block text specified. Use: roam save --block "text" or echo "text" | roam save --block');
            }
            blockText = (await readStdin()).trim();
          }

          if (!blockText) {
            exitWithError('Empty block text');
          }

          // Parse categories
          const categories = options.categories
            ? options.categories.split(',').map(c => c.trim()).filter(Boolean)
            : undefined;

          if (options.debug) {
            printDebug('Block mode', true);
            printDebug('Block text', blockText);
            printDebug('Parent UID', options.parent || 'none');
            printDebug('Target page', options.page || 'daily page');
            printDebug('Categories', categories || 'none');
          }

          const graph = initializeGraph({
            token: API_TOKEN,
            graph: GRAPH_NAME
          });

          // If --parent is specified, create block under that parent using batch operations
          if (options.parent) {
            // Strip (( )) wrapper if present
            const parentUid = options.parent.replace(/^\(\(|\)\)$/g, '');

            const batchOps = new BatchOperations(graph);
            const result = await batchOps.processBatch([{
              action: 'create-block',
              location: {
                'parent-uid': parentUid,
                order: 'last'
              },
              string: blockText,
              uid: '{{uid:new-block}}'
            }]);

            if (result.success && result.uid_map) {
              console.log(result.uid_map['new-block']);
            } else {
              const errorMsg = typeof result.error === 'string'
                ? result.error
                : result.error?.message || 'Unknown error';
              exitWithError(`Failed to save block: ${errorMsg}`);
            }
            return;
          }

          // Default: use MemoryOperations for daily page
          const memoryOps = new MemoryOperations(graph);
          const result = await memoryOps.remember(blockText, categories);

          if (result.success) {
            // Output UID for programmatic use (e.g., stop-hook linking)
            console.log(result.block_uid);
          } else {
            exitWithError('Failed to save block');
          }
          return;
        }

        // Page mode: import content as a page
        let rawContent: string;
        let pageTitle: string;

        if (file) {
          // Read from file
          try {
            rawContent = readFileSync(file, 'utf-8');
          } catch (err) {
            exitWithError(`Could not read file: ${file}`);
          }

          // Derive title from filename if not provided
          pageTitle = options.title || basename(file, '.md').replace('.json', '');
        } else {
          // Read from stdin
          if (process.stdin.isTTY) {
            exitWithError('No file specified and no input piped. Use: roam save <file.md> or cat file.md | roam save --title "Title"');
          }

          if (!options.title) {
            exitWithError('--title is required when piping from stdin');
          }

          rawContent = await readStdin();
          pageTitle = options.title;
        }

        if (!rawContent.trim()) {
          exitWithError('Empty content received');
        }

        if (options.debug) {
          printDebug('Page title', pageTitle);
          printDebug('Content length', rawContent.length);
          printDebug('JSON mode', options.json || false);
          printDebug('Update mode', options.update || false);
        }

        const graph = initializeGraph({
          token: API_TOKEN,
          graph: GRAPH_NAME
        });

        const pageOps = new PageOperations(graph);

        if (options.update) {
          // Use smart diff to update existing page (markdown only)
          if (options.json) {
            exitWithError('--update is not supported with --json mode');
          }
          const result = await pageOps.updatePageMarkdown(
            pageTitle,
            rawContent,
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
          let contentBlocks: ContentBlock[];

          if (options.json) {
            // JSON mode: parse as array of {text, level, heading?}
            try {
              const parsed = JSON.parse(rawContent);
              if (!Array.isArray(parsed)) {
                exitWithError('JSON content must be an array of {text, level, heading?} objects');
              }
              contentBlocks = parsed.map((item: any, index: number) => {
                if (typeof item.text !== 'string' || typeof item.level !== 'number') {
                  exitWithError(`Invalid item at index ${index}: must have "text" (string) and "level" (number)`);
                }
                return {
                  text: item.text,
                  level: item.level,
                  ...(item.heading && { heading: item.heading })
                };
              });
            } catch (err) {
              if (err instanceof SyntaxError) {
                exitWithError(`Invalid JSON: ${err.message}`);
              }
              throw err;
            }
          } else {
            // Markdown mode: parse and flatten
            const nodes = parseMarkdown(rawContent) as MarkdownNode[];
            contentBlocks = flattenNodes(nodes);
          }

          if (contentBlocks.length === 0) {
            exitWithError('No content blocks parsed from input');
          }

          if (options.debug) {
            printDebug('Content blocks', contentBlocks.length);
            if (options.json) {
              printDebug('First block', contentBlocks[0]);
            }
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
