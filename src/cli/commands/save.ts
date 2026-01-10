import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import { PageOperations } from '../../tools/operations/pages.js';
import { TodoOperations } from '../../tools/operations/todos.js';
import { BatchOperations } from '../../tools/operations/batch.js';
import { parseMarkdown, generateBlockUid, parseMarkdownHeadingLevel } from '../../markdown-utils.js';
import { printDebug, exitWithError } from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';
import { readStdin } from '../utils/input.js';
import { formatRoamDate } from '../../utils/helpers.js';
import { q, createPage as roamCreatePage } from '@roam-research/roam-api-sdk';

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
 * Infer hierarchy from heading levels when all blocks are at the same level.
 * This handles prose-style markdown where headings (# ## ###) define structure
 * without explicit indentation.
 *
 * Example: "# Title\n## Chapter\nContent" becomes:
 *   - Title (level 1, H1)
 *     - Chapter (level 2, H2)
 *       - Content (level 3)
 */
function adjustLevelsForHeadingHierarchy(
  blocks: Array<{ text: string; level: number; heading?: number }>
): Array<{ text: string; level: number; heading?: number }> {
  if (blocks.length === 0) return blocks;

  // Only apply heading-based adjustment when:
  // 1. All blocks are at the same level (no indentation-based hierarchy)
  // 2. There are headings present
  const allSameLevel = blocks.every(b => b.level === blocks[0].level);
  const hasHeadings = blocks.some(b => b.heading);

  if (!allSameLevel || !hasHeadings) {
    // Indentation-based hierarchy exists, preserve it
    return blocks;
  }

  const result: Array<{ text: string; level: number; heading?: number }> = [];

  // Track heading stack: each entry is { headingLevel: 1|2|3, adjustedLevel: number }
  const headingStack: Array<{ headingLevel: number; adjustedLevel: number }> = [];

  for (const block of blocks) {
    if (block.heading) {
      // Pop headings of same or lower priority (higher h-number)
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].headingLevel >= block.heading
      ) {
        headingStack.pop();
      }

      // New heading level is one deeper than parent heading (or 1 if no parent)
      const adjustedLevel =
        headingStack.length > 0
          ? headingStack[headingStack.length - 1].adjustedLevel + 1
          : 1;

      headingStack.push({ headingLevel: block.heading, adjustedLevel });
      result.push({ ...block, level: adjustedLevel });
    } else {
      // Content: nest under current heading context
      const adjustedLevel =
        headingStack.length > 0
          ? headingStack[headingStack.length - 1].adjustedLevel + 1
          : 1;
      result.push({ ...block, level: adjustedLevel });
    }
  }

  return result;
}

/**
 * Check if a string looks like a Roam block UID (9 alphanumeric chars with _ or -)
 */
function isBlockUid(value: string): boolean {
  // Strip (( )) wrapper if present
  const cleaned = value.replace(/^\(\(|\)\)$/g, '');
  return /^[a-zA-Z0-9_-]{9}$/.test(cleaned);
}

/**
 * Check if content looks like a JSON array
 */
function looksLikeJsonArray(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']');
}

/**
 * Find or create a page by title, returns UID
 */
async function findOrCreatePage(graph: any, title: string): Promise<string> {
  const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
  const findResults = await q(graph, findQuery, [title]) as [string][];

  if (findResults && findResults.length > 0) {
    return findResults[0][0];
  }

  // Create the page if it doesn't exist
  await roamCreatePage(graph, {
    action: 'create-page',
    page: { title }
  });

  const results = await q(graph, findQuery, [title]) as [string][];
  if (!results || results.length === 0) {
    throw new Error(`Could not find created page: ${title}`);
  }
  return results[0][0];
}

/**
 * Get or create today's daily page UID
 */
async function getDailyPageUid(graph: any): Promise<string> {
  const today = new Date();
  const dateStr = formatRoamDate(today);
  return findOrCreatePage(graph, dateStr);
}

/**
 * Find or create a heading block on a page
 */
async function findOrCreateHeading(graph: any, pageUid: string, heading: string, headingLevel?: number): Promise<string> {
  // Search for existing heading block
  const headingQuery = `[:find ?uid
                        :in $ ?page-uid ?text
                        :where
                        [?page :block/uid ?page-uid]
                        [?page :block/children ?block]
                        [?block :block/string ?text]
                        [?block :block/uid ?uid]]`;
  const headingResults = await q(graph, headingQuery, [pageUid, heading]) as [string][];

  if (headingResults && headingResults.length > 0) {
    return headingResults[0][0];
  }

  // Create the heading block
  const batchOps = new BatchOperations(graph);
  const headingUid = generateBlockUid();

  await batchOps.processBatch([{
    action: 'create-block',
    location: { 'parent-uid': pageUid, order: 'last' },
    string: heading,
    uid: headingUid,
    ...(headingLevel && { heading: headingLevel })
  }]);

  return headingUid;
}

/**
 * Parse JSON content blocks
 */
function parseJsonContent(content: string): ContentBlock[] {
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error('JSON content must be an array of {text, level, heading?} objects');
  }
  return parsed.map((item: any, index: number) => {
    if (typeof item.text !== 'string' || typeof item.level !== 'number') {
      throw new Error(`Invalid item at index ${index}: must have "text" (string) and "level" (number)`);
    }

    // If heading not explicitly provided, detect from text and strip hashes
    if (item.heading) {
      return {
        text: item.text,
        level: item.level,
        heading: item.heading
      };
    }

    const { heading_level, content: strippedText } = parseMarkdownHeadingLevel(item.text);
    return {
      text: strippedText,
      level: item.level,
      ...(heading_level > 0 && { heading: heading_level })
    };
  });
}

interface SaveOptions extends GraphOptions {
  title?: string;
  update?: boolean;
  debug?: boolean;
  page?: string;             // Target page for block (default: daily page)
  parent?: string;           // Parent: block UID or heading text (auto-detected)
  categories?: string;       // Comma-separated category tags
  todo?: string | boolean;   // TODO item text or flag for stdin
  json?: boolean;            // Force JSON format interpretation
  flatten?: boolean;         // Disable heading hierarchy inference
}

interface ContentBlock {
  text: string;
  level: number;
  heading?: number;
}

export function createSaveCommand(): Command {
  return new Command('save')
    .description('Save text, files, or JSON to pages/blocks. Auto-detects format.')
    .argument('[input]', 'Text, file path, or "-" for stdin (auto-detected)')
    .option('--title <title>', 'Create a new page with this title')
    .option('--update', 'Update existing page using smart diff (preserves block UIDs)')
    .option('-p, --page <ref>', 'Target page by title or UID (default: daily page, creates if missing)')
    .option('--parent <ref>', 'Nest under block UID ((uid)) or heading text (creates if missing). Use # prefix for heading level: "## Section"')
    .option('-c, --categories <tags>', 'Comma-separated tags appended to first block')
    .option('-t, --todo [text]', 'Add TODO item(s) to daily page. Accepts inline text or stdin')
    .option('--json', 'Force JSON array format: [{text, level, heading?}, ...]')
    .option('--flatten', 'Disable heading hierarchy inference (all blocks at root level)')
    .option('-g, --graph <name>', 'Target graph key (multi-graph mode)')
    .option('--write-key <key>', 'Write confirmation key (non-default graphs)')
    .option('--debug', 'Show debug information')
    .addHelpText('after', `
Examples:
  # Quick saves to daily page
  roam save "Quick note"                          # Single block
  roam save "# Important" -c "work,urgent"        # H1 heading with tags
  roam save --todo "Buy groceries"                # TODO item

  # Save under heading (creates if missing)
  roam save --parent "## Notes" "My note"         # Under H2 "Notes" heading
  roam save --parent "((blockUid9))" "Child"      # Under specific block

  # Target specific page
  roam save -p "Project X" "Status update"        # By title (creates if missing)
  roam save -p "pageUid123" "Note"                # By UID

  # File operations
  roam save notes.md --title "My Notes"           # Create page from file
  roam save notes.md --title "My Notes" --update  # Smart update (preserves UIDs)
  cat data.json | roam save --json                # Pipe JSON blocks

  # Stdin operations
  echo "Task from CLI" | roam save --todo         # Pipe to TODO
  cat note.md | roam save --title "From Pipe"     # Pipe file content to new page
  echo "Quick capture" | roam save -p "Inbox"     # Pipe to specific page

  # Combine options
  roam save -p "Work" --parent "## Today" "Done with task" -c "wins"

JSON format (--json):
  Array of blocks with text, level, and optional heading:
  [
    {"text": "# Main Title", "level": 1},           # Auto-detects H1
    {"text": "Subheading", "level": 1, "heading": 2}, # Explicit H2
    {"text": "Nested content", "level": 2},         # Child block
    {"text": "Sibling", "level": 2}
  ]
`)
    .action(async (input: string | undefined, options: SaveOptions) => {
      try {
        // TODO mode: add a TODO item to today's daily page
        if (options.todo !== undefined) {
          let todoText: string;

          if (typeof options.todo === 'string' && options.todo.length > 0) {
            todoText = options.todo;
          } else {
            if (process.stdin.isTTY) {
              exitWithError('No TODO text. Use: roam save --todo "text" or echo "text" | roam save --todo');
            }
            todoText = (await readStdin()).trim();
          }

          if (!todoText) {
            exitWithError('Empty TODO text');
          }

          const todos = todoText.split('\n').map(t => t.trim()).filter(Boolean);

          if (options.debug) {
            printDebug('TODO mode', true);
            printDebug('Graph', options.graph || 'default');
            printDebug('TODO items', todos);
          }

          const graph = resolveGraph(options, true);
          const todoOps = new TodoOperations(graph);
          const result = await todoOps.addTodos(todos);

          if (result.success) {
            console.log(`Added ${todos.length} TODO item(s) to today's daily page`);
          } else {
            exitWithError('Failed to save TODO');
          }
          return;
        }

        // Determine content source: file, text argument, or stdin
        let content: string;
        let isFile = false;
        let sourceFilename: string | undefined;

        if (input && input !== '-') {
          // Check if input is a file path that exists
          if (existsSync(input)) {
            isFile = true;
            sourceFilename = input;
            try {
              content = readFileSync(input, 'utf-8');
            } catch (err) {
              exitWithError(`Could not read file: ${input}`);
            }
          } else {
            // Treat as text content
            content = input;
          }
        } else {
          // Read from stdin (or if input is explicit '-')
          if (process.stdin.isTTY && input !== '-') {
            exitWithError('No input. Use: roam save "text", roam save <file>, or pipe content');
          }
          content = await readStdin();
        }

        content = content.trim();
        if (!content) {
          exitWithError('Empty content');
        }

        // Determine format: JSON or markdown/text
        const isJson = options.json || (isFile && sourceFilename?.endsWith('.json')) || looksLikeJsonArray(content);

        // Parse content into blocks
        let contentBlocks: ContentBlock[];
        if (isJson) {
          try {
            contentBlocks = parseJsonContent(content);
          } catch (err) {
            exitWithError(err instanceof Error ? err.message : 'Invalid JSON');
          }
        } else if (isFile || content.includes('\n')) {
          // Multi-line content: parse as markdown
          const nodes = parseMarkdown(content) as MarkdownNode[];
          const flattened = flattenNodes(nodes);
          // Apply heading hierarchy unless --flatten is specified
          contentBlocks = options.flatten ? flattened : adjustLevelsForHeadingHierarchy(flattened);
        } else {
          // Single line text: detect heading syntax and strip hashes
          const { heading_level, content: strippedContent } = parseMarkdownHeadingLevel(content);
          contentBlocks = [{
            text: strippedContent,
            level: 1,
            ...(heading_level > 0 && { heading: heading_level })
          }];
        }

        if (contentBlocks.length === 0) {
          exitWithError('No content blocks parsed');
        }

        // Parse categories
        const categories = options.categories
          ? options.categories.split(',').map(c => c.trim()).filter(Boolean)
          : undefined;

        // Determine parent type if specified
        let parentUid: string | undefined;
        let parentHeading: string | undefined;
        let parentHeadingLevel: number | undefined;

        if (options.parent) {
          const cleanedParent = options.parent.replace(/^\(\(|\)\)$/g, '');
          if (isBlockUid(cleanedParent)) {
            parentUid = cleanedParent;
          } else {
            // Parse heading syntax from parent text
            const { heading_level, content } = parseMarkdownHeadingLevel(options.parent);
            parentHeading = content;
            if (heading_level > 0) {
              parentHeadingLevel = heading_level;
            }
          }
        }

        if (options.debug) {
          printDebug('Input', input || 'stdin');
          printDebug('Is file', isFile);
          printDebug('Is JSON', isJson);
          printDebug('Flatten mode', options.flatten || false);
          printDebug('Graph', options.graph || 'default');
          printDebug('Content blocks', contentBlocks.length);
          printDebug('Parent UID', parentUid || 'none');
          printDebug('Parent heading', parentHeading || 'none');
          printDebug('Target page', options.page || 'daily page');
          printDebug('Categories', categories || 'none');
          printDebug('Title', options.title || 'none');
        }

        const graph = resolveGraph(options, true);

        // Determine operation mode based on options
        const hasParent = parentUid || parentHeading;
        const hasTitle = options.title;
        const wantsPage = hasTitle && !hasParent;

        if (wantsPage || (isFile && !hasParent)) {
          // PAGE MODE: create a page
          const pageTitle = options.title || (sourceFilename ? basename(sourceFilename, '.md').replace('.json', '') : undefined);

          if (!pageTitle) {
            exitWithError('--title required for page creation from stdin');
          }

          const pageOps = new PageOperations(graph);

          if (options.update) {
            if (isJson) {
              exitWithError('--update is not supported with JSON content');
            }
            const result = await pageOps.updatePageMarkdown(pageTitle, content, false);

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
            const result = await pageOps.createPage(pageTitle, contentBlocks);

            if (result.success) {
              console.log(`Created page '${pageTitle}' (uid: ${result.uid})`);
            } else {
              exitWithError(`Failed to create page '${pageTitle}'`);
            }
          }
          return;
        }

        // BLOCK MODE: add content under parent or to daily page
        if (parentUid) {
          // Direct parent UID: use batch operations
          const batchOps = new BatchOperations(graph);

          // Build batch actions for all content blocks
          const actions: any[] = [];
          const uidMap: Record<number, string> = {};

          for (let i = 0; i < contentBlocks.length; i++) {
            const block = contentBlocks[i];
            const uidPlaceholder = `block-${i}`;
            uidMap[i] = uidPlaceholder;

            // Determine parent for this block
            let blockParent: string;
            if (block.level === 1) {
              blockParent = parentUid;
            } else {
              // Find the closest ancestor at level - 1
              let ancestorIndex = i - 1;
              while (ancestorIndex >= 0 && contentBlocks[ancestorIndex].level >= block.level) {
                ancestorIndex--;
              }
              if (ancestorIndex >= 0) {
                blockParent = `{{uid:${uidMap[ancestorIndex]}}}`;
              } else {
                blockParent = parentUid;
              }
            }

            actions.push({
              action: 'create-block',
              location: {
                'parent-uid': blockParent,
                order: 'last'
              },
              string: block.text,
              uid: `{{uid:${uidPlaceholder}}}`,
              ...(block.heading && { heading: block.heading })
            });
          }

          const result = await batchOps.processBatch(actions);

          if (result.success && result.uid_map) {
            // Output the first block's UID
            console.log(result.uid_map['block-0']);
          } else {
            const errorMsg = typeof result.error === 'string'
              ? result.error
              : result.error?.message || 'Unknown error';
            exitWithError(`Failed to save: ${errorMsg}`);
          }
          return;
        }

        // Parent heading or target page: get target page UID first
        let pageUid: string;
        if (options.page) {
          // Strip (( )) wrapper if UID, but NOT [[ ]] (that's valid page title syntax)
          const cleanedPage = options.page.replace(/^\(\(|\)\)$/g, '');
          if (isBlockUid(cleanedPage)) {
            pageUid = cleanedPage;
          } else {
            pageUid = await findOrCreatePage(graph, options.page);
          }
        } else {
          pageUid = await getDailyPageUid(graph);
        }

        if (options.debug) {
          printDebug('Target page UID', pageUid);
        }

        // Resolve heading to parent UID if specified
        let targetParentUid: string;
        if (parentHeading) {
          targetParentUid = await findOrCreateHeading(graph, pageUid, parentHeading, parentHeadingLevel);
        } else {
          targetParentUid = pageUid;
        }

        // Format categories as Roam tags if provided
        const categoryTags = categories?.map(cat => {
          return cat.includes(' ') ? `#[[${cat}]]` : `#${cat}`;
        }).join(' ') || '';

        // Create all blocks using batch operations
        const batchOps = new BatchOperations(graph);
        const actions: any[] = [];
        const uidMap: Record<number, string> = {};

        for (let i = 0; i < contentBlocks.length; i++) {
          const block = contentBlocks[i];
          const uidPlaceholder = `block-${i}`;
          uidMap[i] = uidPlaceholder;

          // Determine parent for this block
          let blockParent: string;
          if (block.level === 1) {
            blockParent = targetParentUid;
          } else {
            // Find the closest ancestor at level - 1
            let ancestorIndex = i - 1;
            while (ancestorIndex >= 0 && contentBlocks[ancestorIndex].level >= block.level) {
              ancestorIndex--;
            }
            if (ancestorIndex >= 0) {
              blockParent = `{{uid:${uidMap[ancestorIndex]}}}`;
            } else {
              blockParent = targetParentUid;
            }
          }

          // Append category tags to first block only
          const blockText = i === 0 && categoryTags
            ? `${block.text} ${categoryTags}`
            : block.text;

          actions.push({
            action: 'create-block',
            location: {
              'parent-uid': blockParent,
              order: 'last'
            },
            string: blockText,
            uid: `{{uid:${uidPlaceholder}}}`,
            ...(block.heading && { heading: block.heading })
          });
        }

        const result = await batchOps.processBatch(actions);

        if (result.success && result.uid_map) {
          // Output first block UID (and parent if heading was used)
          if (parentHeading) {
            console.log(`${result.uid_map['block-0']} ${targetParentUid}`);
          } else {
            console.log(result.uid_map['block-0']);
          }
        } else {
          const errorMsg = typeof result.error === 'string'
            ? result.error
            : result.error?.message || 'Unknown error';
          exitWithError(`Failed to save: ${errorMsg}`);
        }

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
