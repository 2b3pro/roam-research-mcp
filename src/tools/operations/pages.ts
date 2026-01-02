import { Graph, q, createPage as createRoamPage, batchActions, createBlock } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { capitalizeWords } from '../helpers/text.js';
import { resolveRefs } from '../helpers/refs.js';
import type { RoamBlock } from '../types/index.js';
import {
  parseMarkdown,
  convertToRoamMarkdown,
  hasMarkdownTable,
  generateBlockUid
} from '../../markdown-utils.js';
import { pageUidCache } from '../../cache/page-uid-cache.js';
import { buildTableActions, type TableRow } from './table.js';
import { BatchOperations } from './batch.js';
import {
  parseExistingBlocks,
  markdownToBlocks,
  diffBlockTrees,
  generateBatchActions,
  getDiffStats,
  isDiffEmpty,
  summarizeActions,
  type DiffStats,
  type RoamApiBlock,
} from '../../diff/index.js';

// Content item types for createPage
export interface TextContentItem {
  type?: 'text';
  text: string;
  level: number;
  heading?: number;
}

export interface TableContentItem {
  type: 'table';
  level: number;
  headers: string[];
  rows: TableRow[];
}

export type ContentItem = TextContentItem | TableContentItem;

// Helper to get ordinal suffix for dates
function getOrdinalSuffix(day: number): string {
  if (day > 3 && day < 21) return 'th'; // Handles 11th, 12th, 13th
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export class PageOperations {
  private batchOps: BatchOperations;

  constructor(private graph: Graph) {
    this.batchOps = new BatchOperations(graph);
  }

  async findPagesModifiedToday(limit: number = 50, offset: number = 0, sort_order: 'asc' | 'desc' = 'desc') {
    // Define ancestor rule for traversing block hierarchy
    const ancestorRule = `[
      [ (ancestor ?b ?a)
        [?a :block/children ?b] ]
      [ (ancestor ?b ?a)
        [?parent :block/children ?b]
        (ancestor ?parent ?a) ]
    ]`;

    // Get start of today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    try {
      // Query for pages modified today, including modification time for sorting
      let query = `[:find ?title ?time
          :in $ ?start_of_day %
          :where
          [?page :node/title ?title]
          (ancestor ?block ?page)
          [?block :edit/time ?time]
          [(> ?time ?start_of_day)]]`;

      if (limit !== -1) {
        query += ` :limit ${limit}`;
      }
      if (offset > 0) {
        query += ` :offset ${offset}`;
      }

      const results = await q(
        this.graph,
        query,
        [startOfDay.getTime(), ancestorRule]
      ) as [string, number][];

      if (!results || results.length === 0) {
        return {
          success: true,
          pages: [],
          message: 'No pages have been modified today'
        };
      }

      // Sort results by modification time
      results.sort((a, b) => {
        if (sort_order === 'desc') {
          return b[1] - a[1]; // Newest first
        } else {
          return a[1] - b[1]; // Oldest first
        }
      });

      // Extract unique page titles from sorted results
      const uniquePages = Array.from(new Set(results.map(([title]) => title)));

      return {
        success: true,
        pages: uniquePages,
        message: `Found ${uniquePages.length} page(s) modified today`
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to find modified pages: ${error.message}`
      );
    }
  }

  async createPage(
    title: string,
    content?: ContentItem[],
    options?: { skipDailyPageLink?: boolean }
  ): Promise<{ success: boolean; uid: string }> {
    // Ensure title is properly formatted
    const pageTitle = String(title).trim();

    let pageUid: string | undefined;

    // Check cache first to avoid unnecessary query
    const cachedUid = pageUidCache.get(pageTitle);
    if (cachedUid) {
      pageUid = cachedUid;
    } else {
      // First try to find if the page exists
      const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
      type FindResult = [string];
      const findResults = await q(this.graph, findQuery, [pageTitle]) as FindResult[];

      if (findResults && findResults.length > 0) {
        // Page exists, use its UID and cache it
        pageUid = findResults[0][0];
        pageUidCache.set(pageTitle, pageUid);
      } else {
        // Create new page
        try {
          await createRoamPage(this.graph, {
            action: 'create-page',
            page: {
              title: pageTitle
            }
          });

          // Get the new page's UID
          const results = await q(this.graph, findQuery, [pageTitle]) as FindResult[];
          if (!results || results.length === 0) {
            throw new Error('Could not find created page');
          }
          pageUid = results[0][0];
          // Cache the newly created page
          pageUidCache.onPageCreated(pageTitle, pageUid);
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to create page: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    // If content is provided, create blocks using batch operations
    if (content && content.length > 0) {
      try {
        // Idempotency check: If page already has content, skip adding more
        // This prevents duplicate content when the tool is called twice
        const existingBlocksQuery = `[:find (count ?b) .
                                      :where [?p :block/uid "${pageUid}"]
                                             [?p :block/children ?b]]`;
        const existingBlockCountResult = await q(this.graph, existingBlocksQuery, []);
        const existingBlockCount = typeof existingBlockCountResult === 'number' ? existingBlockCountResult : 0;

        if (existingBlockCount && existingBlockCount > 0) {
          // Page already has content - this might be a duplicate call
          // Return success without adding duplicate content
          return { success: true, uid: pageUid };
        }

        // Process content items in order, tracking position for correct placement
        // Tables and text blocks are interleaved at their original positions
        // Tables can be nested under text blocks based on their level
        let currentOrder = 0;
        let pendingTextItems: TextContentItem[] = [];
        // Track last block UID at each level for nesting tables
        const levelToLastUid: { [level: number]: string } = {};

        // Helper to assign UIDs to nodes and track level mapping
        const assignUidsToNodes = (nodes: any[]): any[] => {
          return nodes.map(node => {
            const uid = generateBlockUid();
            levelToLastUid[node.level] = uid;
            return {
              ...node,
              uid,
              children: assignUidsToNodes(node.children)
            };
          });
        };

        // Helper to build batch actions from nodes with pre-assigned UIDs
        const buildActionsFromNodes = (nodes: any[], parentUid: string, startOrder: number): any[] => {
          const actions: any[] = [];
          for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            actions.push({
              action: 'create-block',
              location: { 'parent-uid': parentUid, order: startOrder + i },
              block: {
                uid: node.uid,
                string: node.content,
                ...(node.heading_level && { heading: node.heading_level })
              }
            });
            if (node.children.length > 0) {
              actions.push(...buildActionsFromNodes(node.children, node.uid, 0));
            }
          }
          return actions;
        };

        // Helper to flush pending text items as a batch
        const flushTextItems = async (startOrder: number): Promise<number> => {
          if (pendingTextItems.length === 0) return startOrder;

          // Filter out empty blocks
          const nonEmptyContent = pendingTextItems.filter(block => block.text && block.text.trim().length > 0);
          if (nonEmptyContent.length === 0) {
            pendingTextItems = [];
            return startOrder;
          }

          // Normalize levels to prevent gaps after filtering
          const normalizedContent: TextContentItem[] = [];
          for (let i = 0; i < nonEmptyContent.length; i++) {
            const block = nonEmptyContent[i];
            if (i === 0) {
              normalizedContent.push({ ...block, level: 1 });
            } else {
              const prevLevel = normalizedContent[i - 1].level;
              const maxAllowedLevel = prevLevel + 1;
              normalizedContent.push({
                ...block,
                level: Math.min(block.level, maxAllowedLevel)
              });
            }
          }

          // Convert to node format with level info
          const nodes = normalizedContent.map(block => ({
            content: convertToRoamMarkdown(block.text.replace(/^#+\s*/, '')),
            level: block.level,
            ...(block.heading && { heading_level: block.heading }),
            children: [] as any[]
          }));

          // Create hierarchical structure based on levels
          const rootNodes: any[] = [];
          const levelMap: { [level: number]: any } = {};

          for (const node of nodes) {
            if (node.level === 1) {
              rootNodes.push(node);
              levelMap[1] = node;
            } else {
              const parentLevel = node.level - 1;
              const parent = levelMap[parentLevel];

              if (!parent) {
                throw new Error(`Invalid block hierarchy: level ${node.level} block has no parent`);
              }

              parent.children.push(node);
              levelMap[node.level] = node;
            }
          }

          // Assign UIDs to all nodes and track level->UID mapping
          const nodesWithUids = assignUidsToNodes(rootNodes);

          // Build batch actions from nodes with UIDs
          const textActions = buildActionsFromNodes(nodesWithUids, pageUid, startOrder);

          if (textActions.length > 0) {
            const batchResult = await batchActions(this.graph, {
              action: 'batch-actions',
              actions: textActions
            });

            if (!batchResult) {
              throw new Error('Failed to create text blocks');
            }
          }

          // Return the next order position (number of root-level blocks added)
          const nextOrder = startOrder + rootNodes.length;
          pendingTextItems = [];
          return nextOrder;
        };

        // Process content items in order
        for (let i = 0; i < content.length; i++) {
          const item = content[i];

          if (item.type === 'table') {
            // Flush any pending text items first
            currentOrder = await flushTextItems(currentOrder);

            // Process table - determine parent based on level
            const tableItem = item as TableContentItem;
            const tableLevel = tableItem.level || 1;

            let tableParentUid = pageUid;
            let tableOrder: number | 'last' = currentOrder;

            if (tableLevel > 1) {
              // Nested table - find parent block at level-1
              const parentLevel = tableLevel - 1;
              if (levelToLastUid[parentLevel]) {
                tableParentUid = levelToLastUid[parentLevel];
                tableOrder = 'last'; // Append to parent's children
              }
              // If no parent found, fall back to page level
            }

            const tableActions = buildTableActions({
              parent_uid: tableParentUid,
              headers: tableItem.headers,
              rows: tableItem.rows,
              order: tableOrder
            });

            const tableResult = await this.batchOps.processBatch(tableActions);
            if (!tableResult.success) {
              throw new Error(`Failed to create table: ${typeof tableResult.error === 'string' ? tableResult.error : tableResult.error?.message}`);
            }

            // Only increment top-level order for level 1 tables
            if (tableLevel === 1) {
              currentOrder++;
            }
          } else {
            // Accumulate text items
            pendingTextItems.push(item as TextContentItem);
          }
        }

        // Flush any remaining text items
        await flushTextItems(currentOrder);
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to add content to page: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Add a link to the created page on today's daily page (unless skipped)
    if (!options?.skipDailyPageLink) {
      try {
        const today = new Date();
        const day = today.getDate();
        const month = today.toLocaleString('en-US', { month: 'long' });
        const year = today.getFullYear();
        const formattedTodayTitle = `${month} ${day}${getOrdinalSuffix(day)}, ${year}`;

        // Check cache for daily page
        let dailyPageUid: string | undefined = pageUidCache.get(formattedTodayTitle);
        if (!dailyPageUid) {
          const dailyPageQuery = `[:find ?uid .
                                  :where [?e :node/title "${formattedTodayTitle}"]
                                         [?e :block/uid ?uid]]`;
          const dailyPageResult = await q(this.graph, dailyPageQuery, []);
          dailyPageUid = dailyPageResult ? String(dailyPageResult) : undefined;
          if (dailyPageUid) {
            pageUidCache.set(formattedTodayTitle, dailyPageUid);
          }
        }

        if (dailyPageUid) {
          await createBlock(this.graph, {
            action: 'create-block',
            block: {
              string: `Created page: [[${pageTitle}]]`
            },
            location: {
              'parent-uid': dailyPageUid,
              order: 'last'
            }
          });
        } else {
          console.warn(`Could not find daily page with title: ${formattedTodayTitle}. Link to created page not added.`);
        }
      } catch (error) {
        console.error(`Failed to add link to daily page: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { success: true, uid: pageUid };
  }

  async fetchPageByTitle(
    title: string,
    format: 'markdown' | 'raw' = 'raw'
  ): Promise<string | RoamBlock[]> {
    if (!title) {
      throw new McpError(ErrorCode.InvalidRequest, 'title is required');
    }

    // Try different case variations
    const variations = [
      title, // Original
      capitalizeWords(title), // Each word capitalized
      title.toLowerCase() // All lowercase
    ];

    // Check cache first for any variation
    let uid: string | null = null;
    for (const variation of variations) {
      const cachedUid = pageUidCache.get(variation);
      if (cachedUid) {
        uid = cachedUid;
        break;
      }
    }

    // If not cached, query the database
    if (!uid) {
      const orClause = variations.map(v => `[?e :node/title "${v}"]`).join(' ');
      const searchQuery = `[:find ?uid .
                          :where [?e :block/uid ?uid]
                                 (or ${orClause})]`;

      const result = await q(this.graph, searchQuery, []);
      uid = (result === null || result === undefined) ? null : String(result);

      // Cache the result for the original title
      if (uid) {
        pageUidCache.set(title, uid);
      }
    }

    if (!uid) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Page with title "${title}" not found (tried original, capitalized words, and lowercase)`
      );
    }

    // Define ancestor rule for traversing block hierarchy
    const ancestorRule = `[
      [ (ancestor ?b ?a)
        [?a :block/children ?b] ]
      [ (ancestor ?b ?a)
        [?parent :block/children ?b]
        (ancestor ?parent ?a) ]
    ]`;

    // Get all blocks under this page using ancestor rule
    const blocksQuery = `[:find ?block-uid ?block-str ?order ?parent-uid
                        :in $ % ?page-title
                        :where [?page :node/title ?page-title]
                               [?block :block/string ?block-str]
                               [?block :block/uid ?block-uid]
                               [?block :block/order ?order]
                               (ancestor ?block ?page)
                               [?parent :block/children ?block]
                               [?parent :block/uid ?parent-uid]]`;
    const blocks = await q(this.graph, blocksQuery, [ancestorRule, title]);

    if (!blocks || blocks.length === 0) {
      if (format === 'raw') {
        return [];
      }
      return `${title} (no content found)`;
    }

    // Get heading information for blocks that have it
    const headingsQuery = `[:find ?block-uid ?heading
                          :in $ % ?page-title
                          :where [?page :node/title ?page-title]
                                 [?block :block/uid ?block-uid]
                                 [?block :block/heading ?heading]
                                 (ancestor ?block ?page)]`;
    const headings = await q(this.graph, headingsQuery, [ancestorRule, title]);

    // Create a map of block UIDs to heading levels
    const headingMap = new Map<string, number>();
    if (headings) {
      for (const [blockUid, heading] of headings) {
        headingMap.set(blockUid, heading as number);
      }
    }

    // Create a map of all blocks
    const blockMap = new Map<string, RoamBlock>();
    const rootBlocks: RoamBlock[] = [];

    // First pass: Create all block objects
    for (const [blockUid, blockStr, order, parentUid] of blocks) {
      const resolvedString = await resolveRefs(this.graph, blockStr);
      const block = {
        uid: blockUid,
        string: resolvedString,
        order: order as number,
        heading: headingMap.get(blockUid) || null,
        children: []
      };
      blockMap.set(blockUid, block);

      // If no parent or parent is the page itself, it's a root block
      if (!parentUid || parentUid === uid) {
        rootBlocks.push(block);
      }
    }

    // Second pass: Build parent-child relationships
    for (const [blockUid, _, __, parentUid] of blocks) {
      if (parentUid && parentUid !== uid) {
        const child = blockMap.get(blockUid);
        const parent = blockMap.get(parentUid);
        if (child && parent && !parent.children.includes(child)) {
          parent.children.push(child);
        }
      }
    }

    // Sort blocks recursively
    const sortBlocks = (blocks: RoamBlock[]) => {
      blocks.sort((a, b) => a.order - b.order);
      blocks.forEach(block => {
        if (block.children.length > 0) {
          sortBlocks(block.children);
        }
      });
    };
    sortBlocks(rootBlocks);

    if (format === 'raw') {
      return JSON.stringify(rootBlocks);
    }

    // Convert to markdown with proper nesting
    const toMarkdown = (blocks: RoamBlock[], level: number = 0): string => {
      return blocks
        .map(block => {
          const indent = '  '.repeat(level);
          let md: string;

          // Check block heading level and format accordingly
          if (block.heading && block.heading > 0) {
            // Format as heading with appropriate number of hashtags
            const hashtags = '#'.repeat(block.heading);
            md = `${indent}${hashtags} ${block.string}`;
          } else {
            // No heading, use bullet point (current behavior)
            md = `${indent}- ${block.string}`;
          }

          if (block.children.length > 0) {
            md += '\n' + toMarkdown(block.children, level + 1);
          }
          return md;
        })
        .join('\n');
    };

    return `# ${title}\n\n${toMarkdown(rootBlocks)}`;
  }

  /**
   * Update an existing page with new markdown content using smart diff.
   * Preserves block UIDs where possible and generates minimal changes.
   *
   * @param title - Title of the page to update
   * @param markdown - New GFM markdown content
   * @param dryRun - If true, returns actions without executing them
   * @returns Result with actions, stats, and preserved UIDs
   */
  async updatePageMarkdown(
    title: string,
    markdown: string,
    dryRun: boolean = false
  ): Promise<{
    success: boolean;
    actions: any[];
    stats: DiffStats;
    preservedUids: string[];
    summary: string;
  }> {
    if (!title) {
      throw new McpError(ErrorCode.InvalidRequest, 'title is required');
    }

    if (!markdown) {
      throw new McpError(ErrorCode.InvalidRequest, 'markdown is required');
    }

    // 1. Fetch existing page with raw block data
    const pageTitle = String(title).trim();

    // Try different case variations
    const variations = [
      pageTitle,
      capitalizeWords(pageTitle),
      pageTitle.toLowerCase()
    ];

    let pageUid: string | null = null;

    // Check cache first
    for (const variation of variations) {
      const cachedUid = pageUidCache.get(variation);
      if (cachedUid) {
        pageUid = cachedUid;
        break;
      }
    }

    // If not cached, query the database
    if (!pageUid) {
      const orClause = variations.map(v => `[?e :node/title "${v}"]`).join(' ');
      const searchQuery = `[:find ?uid .
                          :where [?e :block/uid ?uid]
                                 (or ${orClause})]`;
      const result = await q(this.graph, searchQuery, []);
      pageUid = (result === null || result === undefined) ? null : String(result);

      if (pageUid) {
        pageUidCache.set(pageTitle, pageUid);
      }
    }

    if (!pageUid) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Page with title "${title}" not found`
      );
    }

    // 2. Fetch existing blocks with full hierarchy
    const blocksQuery = `[:find (pull ?page [
                            :block/uid
                            :block/string
                            :block/order
                            :block/heading
                            {:block/children ...}
                          ]) .
                          :where [?page :block/uid "${pageUid}"]]`;

    const pageData = await q(this.graph, blocksQuery, []) as unknown as RoamApiBlock | null;

    if (!pageData) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch page data for "${title}"`
      );
    }

    // 3. Parse existing blocks into our format
    const existingBlocks = parseExistingBlocks(pageData);

    // 4. Convert new markdown to block structure
    const newBlocks = markdownToBlocks(markdown, pageUid);

    // 5. Compute diff
    const diff = diffBlockTrees(existingBlocks, newBlocks, pageUid);

    // 6. Generate ordered batch actions
    const actions = generateBatchActions(diff);
    const stats = getDiffStats(diff);
    const summary = isDiffEmpty(diff) ? 'No changes needed' : summarizeActions(actions);

    // 7. Execute if not dry run and there are actions
    if (!dryRun && actions.length > 0) {
      try {
        const batchResult = await batchActions(this.graph, {
          action: 'batch-actions',
          actions: actions
        });

        if (!batchResult) {
          throw new Error('Batch actions returned no result');
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to apply changes: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      success: true,
      actions,
      stats,
      preservedUids: [...diff.preservedUids],
      summary: dryRun ? `[DRY RUN] ${summary}` : summary
    };
  }
}
