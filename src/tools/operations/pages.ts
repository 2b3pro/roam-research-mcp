import { Graph, q, createPage as createRoamPage, updatePage } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ANCESTOR_RULE } from '../../search/ancestor-rule.js';
import { getPageUid as getPageUidHelper } from '../helpers/page-resolution.js';
import { resolveRefs, resolveBlockRefs } from '../helpers/refs.js';
import { executeBatch, executeBatchSafe } from '../helpers/batch-utils.js';
import { pruneHiddenBlocks } from '../helpers/hidden.js';
import type { RoamBlock } from '../types/index.js';
import {
  parseMarkdown,
  convertToRoamMarkdown,
  hasMarkdownTable,
  generateBlockUid
} from '../../markdown-utils.js';
import { executeStagedBatch } from '../../shared/staged-batch.js';
import { escapeBlockString, unescapeBlockString, needsNewlineEscaping, ESCAPED_NEWLINES_MARKER, SOFT_BREAK_SENTINEL } from '../../shared/block-escaping.js';
import { pageUidCache } from '../../cache/page-uid-cache.js';
import { buildTableActions, type TableRow } from './table.js';
import { BatchOperations } from './batch.js';
import {
  parseExistingBlocks,
  pruneHiddenExistingBlocks,
  countHiddenExistingBlocks,
  flattenExistingBlocks,
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
  numbered_children?: boolean;
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
        [startOfDay.getTime(), ANCESTOR_RULE]
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
    content?: ContentItem[]
  ): Promise<{
    success: boolean;
    /**
     * `page_uid`, not `uid`, to match `createOutline` and `importMarkdown`.
     * A bare `uid` does not say what it identifies, and this tool returned it
     * for the same concept its siblings called `page_uid`. Renamed before an
     * outputSchema froze the disagreement into a published contract.
     */
    page_uid: string;
  }> {
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
        // Create new page by adding a page reference to today's daily page
        // This leverages Roam's native behavior: [[Page Title]] creates the page instantly
        try {
          // Get today's daily page title
          const today = new Date();
          const day = today.getDate();
          const month = today.toLocaleString('en-US', { month: 'long' });
          const year = today.getFullYear();
          const dailyPageTitle = `${month} ${day}${getOrdinalSuffix(day)}, ${year}`;

          // Get or create daily page UID
          const dailyPageQuery = `[:find ?uid . :where [?e :node/title "${dailyPageTitle}"] [?e :block/uid ?uid]]`;
          let dailyPageUid = await q(this.graph, dailyPageQuery, []) as unknown as string | null;

          if (!dailyPageUid) {
            // Create daily page first
            await createRoamPage(this.graph, {
              action: 'create-page',
              page: { title: dailyPageTitle }
            });
            // Small delay for daily page creation to be available as parent
            await new Promise(resolve => setTimeout(resolve, 400));
            dailyPageUid = await q(this.graph, dailyPageQuery, []) as unknown as string | null;
          }

          if (!dailyPageUid) {
            throw new Error(`Could not resolve daily page "${dailyPageTitle}"`);
          }

          // Create block with page reference - this instantly creates the target page
          await executeBatch(this.graph, [{
            action: 'create-block',
            location: { 'parent-uid': dailyPageUid, order: 'last' },
            block: { string: `Created page: [[${pageTitle}]]` }
          }], 'create page reference block');

          // Now query for the page UID - should exist immediately
          const results = await q(this.graph, findQuery, [pageTitle]) as FindResult[];
          if (!results || results.length === 0) {
            throw new Error(`Could not find created page "${pageTitle}"`);
          }
          pageUid = results[0][0];
          // Cache the newly created page
          pageUidCache.onPageCreated(pageTitle, pageUid);
          // Small delay for new page to be fully available as parent in Roam
          // (fixes "Parent entity doesn't exist" error when adding content immediately)
          await new Promise(resolve => setTimeout(resolve, 400));
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
          return { success: true, page_uid: pageUid };
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
                ...(node.heading_level && { heading: node.heading_level }),
                ...(node.children_view_type && { 'children-view-type': node.children_view_type })
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
            content: convertToRoamMarkdown(block.text.replace(/^#+\s+/, '')),
            level: block.level,
            ...(block.heading && { heading_level: block.heading }),
            ...(block.numbered_children && { children_view_type: 'numbered' as const }),
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
            // Use staged batch to ensure parent blocks exist before children
            await executeStagedBatch(this.graph, textActions, {
              context: 'page content creation',
              delayBetweenLevels: 100
            });
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

    // Add a "Processed: [[date]]" block as the last block of the newly created page
    const today = new Date();
    const day = today.getDate();
    const month = today.toLocaleString('en-US', { month: 'long' });
    const year = today.getFullYear();
    const formattedTodayTitle = `${month} ${day}${getOrdinalSuffix(day)}, ${year}`;

    await executeBatchSafe(this.graph, [{
      action: 'create-block',
      location: { 'parent-uid': pageUid, order: 'last' },
      block: { string: `Processed: [[${formattedTodayTitle}]]` }
    }], 'add Processed block');

    return { success: true, page_uid: pageUid };
  }

  /**
   * Get the UID for a page by its title.
   * Tries different case variations (original, capitalized, lowercase).
   * Returns null if not found.
   */
  async getPageUid(title: string): Promise<string | null> {
    return getPageUidHelper(this.graph, title);
  }

  /**
   * Fetch a page by its UID.
   * Returns the page title and blocks, or null if not found.
   */
  async fetchPageByUid(uid: string): Promise<{ title: string; blocks: RoamBlock[] } | null> {
    if (!uid) {
      return null;
    }

    // First get the page title
    const titleQuery = `[:find ?title . :where [?e :block/uid "${uid}"] [?e :node/title ?title]]`;
    const title = await q(this.graph, titleQuery, []) as unknown as string | null;

    if (!title) {
      return null;
    }

    // Get all blocks under this page using ancestor rule
    const blocksQuery = `[:find ?block-uid ?block-str ?order ?parent-uid
                        :in $ % ?page-uid
                        :where [?page :block/uid ?page-uid]
                               [?block :block/string ?block-str]
                               [?block :block/uid ?block-uid]
                               [?block :block/order ?order]
                               (ancestor ?block ?page)
                               [?parent :block/children ?block]
                               [?parent :block/uid ?parent-uid]]`;
    const blocks = await q(this.graph, blocksQuery, [ANCESTOR_RULE, uid]);

    if (!blocks || blocks.length === 0) {
      return { title, blocks: [] };
    }

    // Get heading information for blocks that have it
    const headingsQuery = `[:find ?block-uid ?heading
                          :in $ % ?page-uid
                          :where [?page :block/uid ?page-uid]
                                 [?block :block/uid ?block-uid]
                                 [?block :block/heading ?heading]
                                 (ancestor ?block ?page)]`;
    const headings = await q(this.graph, headingsQuery, [ANCESTOR_RULE, uid]);

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
      const block = {
        uid: blockUid,
        string: blockStr,
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

    // Withhold subtrees the user tagged #.rm-hide / #.rm-private. Done here, at
    // the single point where a page's tree is assembled, so every caller that
    // renders a page (markdown, raw, structure) inherits it.
    return { title, blocks: pruneHiddenBlocks(rootBlocks) };
  }

  async fetchPageByTitle(
    title: string,
    format: 'markdown' | 'raw' | 'structure' = 'raw',
    /**
     * Encode newlines so each block is one line (`shared/block-escaping.ts`).
     * Required by anything whose output may be fed back to
     * `roam_update_page_markdown`; wrong for anything shown as prose.
     *
     * Defaults to OFF so a caller that has not considered this renders today's
     * output rather than silently acquiring doubled backslashes. `guidelines.ts`
     * relies on that default.
     */
    options: { escapeNewlines?: boolean } = {}
  ): Promise<string> {
    if (!title) {
      throw new McpError(ErrorCode.InvalidRequest, 'title is required');
    }

    // Use getPageUid which handles caching and case variations
    const uid = await this.getPageUid(title);

    if (!uid) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Page with title "${title}" not found (tried original, capitalized words, and lowercase)`
      );
    }

    // Get all blocks under this page using ancestor rule
    // Use UID to avoid case-sensitivity issues (getPageUid handles case variations)
    const blocksQuery = `[:find ?block-uid ?block-str ?order ?parent-uid
                        :in $ % ?page-uid
                        :where [?page :block/uid ?page-uid]
                               [?block :block/string ?block-str]
                               [?block :block/uid ?block-uid]
                               [?block :block/order ?order]
                               (ancestor ?block ?page)
                               [?parent :block/children ?block]
                               [?parent :block/uid ?parent-uid]]`;
    const blocks = await q(this.graph, blocksQuery, [ANCESTOR_RULE, uid]);

    if (!blocks || blocks.length === 0) {
      if (format === 'raw') {
        return '[]';  // Return JSON string, not array (MCP text field requires string)
      }
      return `${title} (no content found)`;
    }

    // Get heading information for blocks that have it
    const headingsQuery = `[:find ?block-uid ?heading
                          :in $ % ?page-uid
                          :where [?page :block/uid ?page-uid]
                                 [?block :block/uid ?block-uid]
                                 [?block :block/heading ?heading]
                                 (ancestor ?block ?page)]`;
    const headings = await q(this.graph, headingsQuery, [ANCESTOR_RULE, uid]);

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
    const allBlocks: RoamBlock[] = [];

    // First pass: Create all block objects
    for (const [blockUid, blockStr, order, parentUid] of blocks) {
      const block = {
        uid: blockUid,
        string: blockStr,
        order: order as number,
        heading: headingMap.get(blockUid) || null,
        children: []
      };
      blockMap.set(blockUid, block);
      allBlocks.push(block);

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

    // Withhold #.rm-hide / #.rm-private subtrees before ANY format renders
    // them. This function builds its own tree rather than reusing
    // fetchPageByUid, so it needs its own prune — that duplication is exactly
    // how this path shipped unfiltered the first time.
    const visibleRoots = pruneHiddenBlocks(rootBlocks);
    // Collect from the PRUNED tree, not by filtering allBlocks: pruning copies
    // any node that has children, so the originals are no longer the objects
    // rendered below, and the markdown branch mutates these in place.
    const visibleBlocks: RoamBlock[] = [];
    const collectVisible = (bs: RoamBlock[]) => {
      for (const b of bs) {
        visibleBlocks.push(b);
        if (b.children.length > 0) collectVisible(b.children);
      }
    };
    collectVisible(visibleRoots);

    if (format === 'raw') {
      // Resolve structured references for raw JSON output
      await resolveBlockRefs(this.graph, visibleBlocks, 2);
      return JSON.stringify(visibleRoots);
    }

    if (format === 'structure') {
      // Flatten the tree into a list optimized for surgical updates: this
      // format exists to hand an agent the UIDs and shape of a page cheaply, so
      // `text` is a PREVIEW, cut at PREVIEW_CHARS.
      //
      // That cut is the format's one sharp edge. The tool description sells the
      // output as "optimized for surgical updates", and the obvious next move —
      // feed these entries to roam_process_batch_actions as update-block
      // strings — silently replaces every long block with its own first 80
      // characters. The `...` suffix was the only signal, and an agent
      // reassembling content does not reliably read punctuation as a warning.
      //
      // So a cut entry now says so in a field: `truncated: true`, plus
      // `full_length` so the agent can see how much is missing. The payload
      // also carries a one-line instruction, but ONLY when something was
      // actually cut — a warning present on every response is a warning that
      // gets skimmed. Widening the cut, or removing it, would change what an
      // unchanged call returns; marking it does not.
      const PREVIEW_CHARS = 80;

      interface StructureBlock {
        uid: string;
        order: number;
        text: string;
        depth: number;
        parent_uid: string;
        heading?: number;
        /** Present only when `text` is a fragment. Never write it back. */
        truncated?: true;
        /** Character length of the real block string, when truncated. */
        full_length?: number;
      }

      const flattenBlocks = (
        blocks: RoamBlock[],
        depth: number,
        parentUid: string
      ): StructureBlock[] => {
        const result: StructureBlock[] = [];
        for (const block of blocks) {
          const isTruncated = block.string.length > PREVIEW_CHARS;
          const preview = isTruncated
            ? block.string.substring(0, PREVIEW_CHARS) + '...'
            : block.string;

          const entry: StructureBlock = {
            uid: block.uid,
            order: block.order,
            text: preview,
            depth,
            parent_uid: parentUid
          };

          if (isTruncated) {
            entry.truncated = true;
            entry.full_length = block.string.length;
          }

          if (block.heading) {
            entry.heading = block.heading;
          }

          result.push(entry);

          // Recurse into children
          if (block.children.length > 0) {
            result.push(...flattenBlocks(block.children, depth + 1, block.uid));
          }
        }
        return result;
      };

      const structureBlocks = flattenBlocks(visibleRoots, 0, uid);
      const truncatedCount = structureBlocks.filter((b) => b.truncated).length;

      return JSON.stringify({
        page_uid: uid,
        title: title,
        block_count: structureBlocks.length,
        ...(truncatedCount > 0 && {
          truncated_count: truncatedCount,
          warning:
            `${truncatedCount} block${truncatedCount === 1 ? '' : 's'} shown here ` +
            `${truncatedCount === 1 ? 'is' : 'are'} cut off at ${PREVIEW_CHARS} characters ` +
            `(marked \`truncated: true\`). Their \`text\` is a preview for orientation, not content. ` +
            `Writing it back would replace the block with its opening fragment — ` +
            `fetch the block with roam_fetch_block to get its full string before editing it.`
        }),
        blocks: structureBlocks
      });
    }

    // For markdown, resolve references inline
    await Promise.all(visibleBlocks.map(async b => {
      b.string = await resolveRefs(this.graph, b.string);
    }));

    // Collect every visible block string to decide whether this page needs the
    // encoding at all. A page with no soft line break renders exactly as it
    // did before this feature existed.
    const allStrings: string[] = [];
    const collectStrings = (blocks: RoamBlock[]): void => {
      for (const b of blocks) {
        allStrings.push(b.string);
        collectStrings(b.children);
      }
    };
    collectStrings(visibleRoots);

    const escaping = options.escapeNewlines === true && needsNewlineEscaping(allStrings);

    // Convert to markdown with proper nesting
    const toMarkdown = (blocks: RoamBlock[], level: number = 0): string => {
      return blocks
        .map(block => {
          const indent = '  '.repeat(level);
          let md: string;

          const text = escaping
            ? escapeBlockString(block.string)
            : block.string;

          // Check block heading level and format accordingly
          if (block.heading && block.heading > 0) {
            // Format as heading with appropriate number of hashtags
            const hashtags = '#'.repeat(block.heading);
            md = `${indent}${hashtags} ${text}`;
          } else {
            // No heading, use bullet point (current behavior)
            md = `${indent}- ${text}`;
          }

          if (block.children.length > 0) {
            md += '\n' + toMarkdown(block.children, level + 1);
          }
          return md;
        })
        .join('\n');
    };

    const body = toMarkdown(visibleRoots);
    return escaping
      ? `# ${title}\n${ESCAPED_NEWLINES_MARKER}\n\n${body}`
      : `# ${title}\n\n${body}`;
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
    /**
     * snake_case because this crosses the tool boundary, unlike the camelCase
     * `DiffResult.preservedUids` it is built from. Renamed before it was frozen
     * into an outputSchema, where the inconsistency would have become a promise.
     */
    preserved_uids: string[];
    summary: string;
  }> {
    if (!title) {
      throw new McpError(ErrorCode.InvalidRequest, 'title is required');
    }

    if (!markdown) {
      throw new McpError(ErrorCode.InvalidRequest, 'markdown is required');
    }

    // 1. Fetch existing page with raw block data
    const pageUid = await getPageUidHelper(this.graph, String(title).trim());
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
    const allExistingBlocks = parseExistingBlocks(pageData);

    // 3a. Withhold #.rm-hide / #.rm-private subtrees from the BASELINE, not
    // just from reads. The query above deliberately pulls the whole page —
    // block UIDs and ordering have to be complete for the diff to preserve
    // references — but diffing against blocks the caller was never shown is
    // how the hide filter became a deletion mechanism: unseen content cannot
    // appear in replacement markdown, and this diff deletes whatever the
    // markdown does not account for. The baseline must match what could be
    // read. See `pruneHiddenExistingBlocks`.
    const hiddenCount = countHiddenExistingBlocks(allExistingBlocks);
    const existingBlocks = pruneHiddenExistingBlocks(allExistingBlocks);

    // 4. Convert new markdown to block structure
    //
    // Decode ONLY when our own renderer said it encoded. The marker may be
    // the first non-empty line (header stripped by the caller) or the first
    // non-empty line after a single leading `#` header (payload submitted
    // verbatim — the path `roam save --update` takes). Revision 2 checked
    // only the first line; a verbatim submit therefore never decoded, wrote
    // the marker as a block, and deleted the blocks it rewrote. The tests
    // that should have caught it stripped the header themselves.
    const lines = markdown.split('\n');
    let markerAt = -1;
    let nonEmptySeen = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.length === 0) continue;
      nonEmptySeen++;
      if (t === ESCAPED_NEWLINES_MARKER) {
        markerAt = i;
        break;
      }
      // A single leading header line may precede the marker; anything else
      // (or a second line that is not the marker) means an unmarked payload.
      if (nonEmptySeen === 1 && t.startsWith('#')) continue;
      break;
    }
    const isEscaped = markerAt !== -1;

    // `fetchPageByTitle`'s markdown branch always prepends `# ${title}\n` --
    // it is page-level metadata describing what page this is, never content.
    // Tolerating the marker after that header (above) is not enough on its
    // own: a verbatim round trip still hands that literal `# Title` line to
    // the parser, which turns it into a real heading block with no match in
    // the existing tree, so the diff creates it and reparents every sibling
    // after it -- exactly the "no-op round trip" this marker exists to
    // guarantee. Strip it whenever the first non-empty line matches this
    // page's own title exactly -- but ONLY when the payload demonstrably came
    // from our own renderer (`isEscaped`, or the body still carries the
    // `⏎` sentinel -- the signature of a marker-dropped degradation, since
    // that scenario is "an agent rebuilt our output and lost the marker" and
    // the sentinel is what that rebuilding could not have removed). A FRESH,
    // hand-authored page can legitimately open with an H1 that echoes its own
    // title (imported docs; an author who titles their own first line) --
    // essentially never with `⏎` in it. The two wrong calls are not
    // symmetric: preserving the header when it should have been stripped
    // creates a harmless, visible stray block; stripping it when it should
    // not have been touched deletes -- or reparents into corruption -- real,
    // unrecoverable content, with no undo. The gate always takes the harmless
    // direction whenever the payload carries no provenance signal.
    const trimmedTitle = String(title).trim();
    const firstNonEmptyAt = lines.findIndex((l) => l.trim().length > 0);
    const hasRendererProvenance = isEscaped || markdown.includes(SOFT_BREAK_SENTINEL);
    const titleHeaderAt =
      hasRendererProvenance &&
      firstNonEmptyAt !== -1 &&
      lines[firstNonEmptyAt].trim() === `# ${trimmedTitle}`
        ? firstNonEmptyAt
        : -1;

    let effectiveMarkdown = markdown;
    const linesToStrip = [isEscaped ? markerAt : -1, titleHeaderAt]
      .filter((i) => i !== -1)
      .sort((a, b) => b - a);
    if (linesToStrip.length > 0) {
      // Strip the marker line itself, or it becomes a stray block on the
      // page. Descending order so removing one index never shifts the other.
      for (const idx of linesToStrip) lines.splice(idx, 1);
      effectiveMarkdown = lines.join('\n');
    }

    // Decode AFTER parsing, per block -- never on the whole document before
    // parsing. Decoding the document first would turn every `\n` into a real
    // newline and then split on newlines, which is exactly the flattening
    // bug this whole effort exists to fix.
    const newBlocks = markdownToBlocks(effectiveMarkdown, pageUid);

    // Submitting empty/whitespace markdown is the documented way to clear a
    // page, and stays untouched below. This guards the DIFFERENT case: markdown
    // that is NOT empty but still parsed to zero blocks. That only happens when
    // the parser swallowed the payload -- the known cause is a first block
    // whose string is a bare fence opener (e.g. a line reading "- ```js" with
    // nothing to close it), which is exactly the shape our own renderer emits
    // for a Roam block whose string starts with a fence, and the shape a
    // pasted code snippet produces. `markdownToBlocks` then returns an empty
    // array, and diffing 0 new blocks against N existing ones deletes all N --
    // silently, against an API with no undo. The asymmetry is deliberate: an
    // empty parse of EMPTY input is the documented clear-the-page instruction;
    // an empty parse of NON-EMPTY input is the parser losing the payload, never
    // an instruction to delete anything.
    if (effectiveMarkdown.trim().length > 0 && newBlocks.length === 0) {
      const existingCount = flattenExistingBlocks(existingBlocks).length;
      if (existingCount > 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `markdown parsed to zero blocks even though it is not empty. This usually ` +
          `means an unterminated \`\`\` fence swallowed the whole payload (a first ` +
          `block that opens a code fence and never closes it consumes every line ` +
          `after it). Refusing to write: this would have deleted all ${existingCount} ` +
          `existing block${existingCount === 1 ? '' : 's'} on "${title}". Check the ` +
          `markdown for an unbalanced fence, or call again with dry_run: true to ` +
          `inspect the planned actions before writing.`
        );
      }
    }

    if (isEscaped) {
      for (const block of newBlocks) {
        block.text = unescapeBlockString(block.text);
      }
    }

    // 5. Compute diff
    const diff = diffBlockTrees(existingBlocks, newBlocks, pageUid);

    // 6. Generate ordered batch actions
    const actions = generateBatchActions(diff);
    const stats = getDiffStats(diff);
    const summary = isDiffEmpty(diff) ? 'No changes needed' : summarizeActions(actions);

    // 7. Execute if not dry run and there are actions
    if (!dryRun && actions.length > 0) {
      try {
        // Use staged batch to ensure parent blocks exist before children
        await executeStagedBatch(this.graph, actions, {
          context: 'page update',
          delayBetweenLevels: 100
        });
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to apply changes: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Report the protection rather than applying it silently. Without this, a
    // caller told "3 blocks deleted, 5 created" has no way to explain the
    // blocks still on the page afterwards, and a user debugging that has
    // nothing to go on. It is a count, never content — and these tags are
    // documented as "keep it out of the AI's way", not a secrecy boundary
    // (`tools/helpers/hidden.ts`), so a count is well within their contract.
    const preservationNote =
      hiddenCount > 0
        ? ` ${hiddenCount} hidden block${hiddenCount === 1 ? '' : 's'} ` +
          `(#.rm-hide / #.rm-private) ${hiddenCount === 1 ? 'was' : 'were'} excluded from the diff and left untouched.`
        : '';

    return {
      success: true,
      actions,
      stats,
      preserved_uids: [...diff.preservedUids],
      ...(hiddenCount > 0 && { preserved_hidden: hiddenCount }),
      summary: (dryRun ? `[DRY RUN] ${summary}` : summary) + preservationNote
    };
  }

  /**
   * Rename a page by updating its title
   */
  async renamePage(params: { old_title?: string; uid?: string; new_title: string }): Promise<{ success: boolean; message: string }> {
    const { old_title, uid, new_title } = params;

    if (!old_title && !uid) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Either old_title or uid must be provided to identify the page'
      );
    }

    // Build the page identifier
    const pageIdentifier = uid ? { uid } : { title: old_title };

    try {
      const success = await updatePage(this.graph, {
        page: pageIdentifier,
        title: new_title
      });

      if (success) {
        const identifier = uid ? `((${uid}))` : `"${old_title}"`;
        return {
          success: true,
          message: `Renamed ${identifier} → "${new_title}"`
        };
      } else {
        return {
          success: false,
          message: 'Failed to rename page (API returned false)'
        };
      }
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to rename page: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
