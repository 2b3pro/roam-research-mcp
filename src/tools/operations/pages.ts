import { Graph, q, createPage as createRoamPage, batchActions, createBlock } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { capitalizeWords } from '../helpers/text.js';
import { resolveRefs } from '../helpers/refs.js';
import type { RoamBlock } from '../types/index.js';
import { 
  parseMarkdown, 
  convertToRoamActions,
  convertToRoamMarkdown,
  hasMarkdownTable 
} from '../../markdown-utils.js';

export class PageOperations {
  constructor(private graph: Graph) {}

  async findPagesModifiedToday(max_num_pages: number = 50) {
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
      // Query for pages modified today
      const results = await q(
        this.graph,
        `[:find ?title
          :in $ ?start_of_day %
          :where
          [?page :node/title ?title]
          (ancestor ?block ?page)
          [?block :edit/time ?time]
          [(> ?time ?start_of_day)]]
          :limit ${max_num_pages}`,
        [startOfDay.getTime(), ancestorRule]
      ) as [string][];

      if (!results || results.length === 0) {
        return {
          success: true,
          pages: [],
          message: 'No pages have been modified today'
        };
      }

      // Extract unique page titles
      const uniquePages = [...new Set(results.map(([title]) => title))];

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

  async createPage(title: string, content?: Array<{text: string; level: number; heading?: number}>): Promise<{ success: boolean; uid: string }> {
    // Ensure title is properly formatted
    const pageTitle = String(title).trim();
    
    // First try to find if the page exists
    const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
    type FindResult = [string];
    const findResults = await q(this.graph, findQuery, [pageTitle]) as FindResult[];
    
    let pageUid: string | undefined;
    
    if (findResults && findResults.length > 0) {
      // Page exists, use its UID
      pageUid = findResults[0][0];
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
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to create page: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    
    // If content is provided, create blocks using batch operations
    if (content && content.length > 0) {
      try {
        // Convert content array to MarkdownNode format expected by convertToRoamActions
        const nodes = content.map(block => ({
          content: block.text,
          level: block.level,
          ...(block.heading && { heading_level: block.heading }),
          children: []
        }));
        
        // Create hierarchical structure based on levels
        const rootNodes: any[] = [];
        const levelMap: {[level: number]: any} = {};
        
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
        
        // Generate batch actions for all blocks
        const actions = convertToRoamActions(rootNodes, pageUid, 'last');
        
        // Execute batch operation
        if (actions.length > 0) {
          const batchResult = await batchActions(this.graph, {
            action: 'batch-actions',
            actions
          });
          
          if (!batchResult) {
            throw new Error('Failed to create blocks');
          }
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to add content to page: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    
    return { success: true, uid: pageUid };
  }

  async fetchPageByTitle(title: string): Promise<string> {
    if (!title) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'title is required'
      );
    }

    // Try different case variations
    const variations = [
      title, // Original
      capitalizeWords(title), // Each word capitalized
      title.toLowerCase() // All lowercase
    ];

    let uid: string | null = null;
    for (const variation of variations) {
      const searchQuery = `[:find ?uid .
                          :where [?e :node/title "${variation}"]
                                 [?e :block/uid ?uid]]`;
      const result = await q(this.graph, searchQuery, []);
      uid = (result === null || result === undefined) ? null : String(result);
      if (uid) break;
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

    // Convert to markdown with proper nesting
    const toMarkdown = (blocks: RoamBlock[], level: number = 0): string => {
      return blocks.map(block => {
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
      }).join('\n');
    };

    return `# ${title}\n\n${toMarkdown(rootBlocks)}`;
  }
}
