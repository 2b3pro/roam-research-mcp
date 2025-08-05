import { Graph, q, createPage, createBlock, batchActions } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { formatRoamDate } from '../../utils/helpers.js';
import { capitalizeWords } from '../helpers/text.js';
import { 
  parseMarkdown, 
  convertToRoamActions,
  convertToRoamMarkdown,
  hasMarkdownTable,
  type BatchAction 
} from '../../markdown-utils.js';
import type { OutlineItem, NestedBlock } from '../types/index.js';

export class OutlineOperations {
  constructor(private graph: Graph) {}

  /**
   * Creates an outline structure on a Roam Research page, optionally under a specific block.
   *
   * @param outline - An array of OutlineItem objects, each containing text and a level.
   *                  Markdown heading syntax (#, ##, ###) in the text will be recognized
   *                  and converted to Roam headings while preserving the outline's hierarchical
   *                  structure based on indentation.
   * @param page_title_uid - The title or UID of the page where the outline should be created.
   *                         If not provided, today's daily page will be used.
   * @param block_text_uid - Optional. The text content or UID of an existing block under which
   *                         the outline should be inserted. If a text string is provided and
   *                         no matching block is found, a new block with that text will be created
   *                         on the page to serve as the parent. If a UID is provided and the block
   *                         is not found, an error will be thrown.
   * @returns An object containing success status, page UID, parent UID, and a nested array of created block UIDs.
   */
  async createOutline(
    outline: Array<OutlineItem>,
    page_title_uid?: string,
    block_text_uid?: string
  ): Promise<{ success: boolean; page_uid: string; parent_uid: string; created_uids: NestedBlock[] }> {
    // Validate input
    if (!Array.isArray(outline) || outline.length === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'outline must be a non-empty array'
      );
    }

    // Filter out items with undefined text
    const validOutline = outline.filter(item => item.text !== undefined);
    if (validOutline.length === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'outline must contain at least one item with text'
      );
    }

    // Validate outline structure
    const invalidItems = validOutline.filter(item => 
      typeof item.level !== 'number' || 
      item.level < 1 || 
      item.level > 10 ||
      typeof item.text !== 'string' ||
      item.text.trim().length === 0
    );
    
    if (invalidItems.length > 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'outline contains invalid items - each item must have a level (1-10) and non-empty text'
      );
    }

    // Helper function to find or create page with retries
    const findOrCreatePage = async (titleOrUid: string, maxRetries = 3, delayMs = 500): Promise<string> => {
      // First try to find by title
      const titleQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
      const variations = [
        titleOrUid, // Original
        capitalizeWords(titleOrUid), // Each word capitalized
        titleOrUid.toLowerCase() // All lowercase
      ];

      for (let retry = 0; retry < maxRetries; retry++) {
        // Try each case variation
        for (const variation of variations) {
          const findResults = await q(this.graph, titleQuery, [variation]) as [string][];
          if (findResults && findResults.length > 0) {
            return findResults[0][0];
          }
        }

        // If not found as title, try as UID
        const uidQuery = `[:find ?uid
                          :where [?e :block/uid "${titleOrUid}"]
                                 [?e :block/uid ?uid]]`;
        const uidResult = await q(this.graph, uidQuery, []);
        if (uidResult && uidResult.length > 0) {
          return uidResult[0][0];
        }

        // If still not found and this is the first retry, try to create the page
        if (retry === 0) {
          const success = await createPage(this.graph, {
            action: 'create-page',
            page: { title: titleOrUid }
          });

          // Even if createPage returns false, the page might still have been created
          // Wait a bit and continue to next retry
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        if (retry < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to find or create page "${titleOrUid}" after multiple attempts`
      );
    };

    // Get or create the target page
    const targetPageUid = await findOrCreatePage(
      page_title_uid || formatRoamDate(new Date())
    );

    // Helper function to find block with improved relationship checks
    const findBlockWithRetry = async (pageUid: string, blockString: string, maxRetries = 5, initialDelay = 1000): Promise<string> => {
      // Try multiple query strategies
      const queries = [
        // Strategy 1: Direct page and string match
        `[:find ?b-uid ?order
          :where [?p :block/uid "${pageUid}"]
                 [?b :block/page ?p]
                 [?b :block/string "${blockString}"]
                 [?b :block/order ?order]
                 [?b :block/uid ?b-uid]]`,
        
        // Strategy 2: Parent-child relationship
        `[:find ?b-uid ?order
          :where [?p :block/uid "${pageUid}"]
                 [?b :block/parents ?p]
                 [?b :block/string "${blockString}"]
                 [?b :block/order ?order]
                 [?b :block/uid ?b-uid]]`,
        
        // Strategy 3: Broader page relationship
        `[:find ?b-uid ?order
          :where [?p :block/uid "${pageUid}"]
                 [?b :block/page ?page]
                 [?p :block/page ?page]
                 [?b :block/string "${blockString}"]
                 [?b :block/order ?order]
                 [?b :block/uid ?b-uid]]`
      ];

      for (let retry = 0; retry < maxRetries; retry++) {
        // Try each query strategy
        for (const queryStr of queries) {
          const blockResults = await q(this.graph, queryStr, []) as [string, number][];
          if (blockResults && blockResults.length > 0) {
            // Use the most recently created block
            const sorted = blockResults.sort((a, b) => b[1] - a[1]);
            return sorted[0][0];
          }
        }

        // Exponential backoff
        const delay = initialDelay * Math.pow(2, retry);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        console.log(`Retry ${retry + 1}/${maxRetries} finding block "${blockString}" under "${pageUid}"`);
      }

      throw new McpError(
        ErrorCode.InternalError,
        `Failed to find block "${blockString}" under page "${pageUid}" after trying multiple strategies`
      );
    };

    // Helper function to create and verify block with improved error handling
    const createAndVerifyBlock = async (
      content: string,
      parentUid: string,
      maxRetries = 5,
      initialDelay = 1000,
      isRetry = false
    ): Promise<string> => {
      try {
        // Initial delay before any operations
        if (!isRetry) {
          await new Promise(resolve => setTimeout(resolve, initialDelay));
        }

        for (let retry = 0; retry < maxRetries; retry++) {
          console.log(`Attempt ${retry + 1}/${maxRetries} to create block "${content}" under "${parentUid}"`);

          // Create block using batchActions
          const batchResult = await batchActions(this.graph, {
            action: 'batch-actions',
            actions: [{
              action: 'create-block',
              location: {
                'parent-uid': parentUid,
                order: 'last'
              },
              block: { string: content }
            }]
          });

          if (!batchResult) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to create block "${content}" via batch action`
            );
          }

          // Wait with exponential backoff
          const delay = initialDelay * Math.pow(2, retry);
          await new Promise(resolve => setTimeout(resolve, delay));

          try {
            // Try to find the block using our improved findBlockWithRetry
            return await findBlockWithRetry(parentUid, content);
          } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`Failed to find block on attempt ${retry + 1}: ${errorMessage}`);
            if (retry === maxRetries - 1) throw error;
          }
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Failed to create and verify block "${content}" after ${maxRetries} attempts`
        );
      } catch (error) {
        // If this is already a retry, throw the error
        if (isRetry) throw error;

        // Otherwise, try one more time with a clean slate
        console.log(`Retrying block creation for "${content}" with fresh attempt`);
        await new Promise(resolve => setTimeout(resolve, initialDelay * 2));
        return createAndVerifyBlock(content, parentUid, maxRetries, initialDelay, true);
      }
    };

    // Helper function to check if string is a valid Roam UID (9 characters)
    const isValidUid = (str: string): boolean => {
      return typeof str === 'string' && str.length === 9;
    };

    // Helper function to fetch a block and its children recursively
    const fetchBlockWithChildren = async (blockUid: string, level: number = 1): Promise<NestedBlock | null> => {
      const query = `
        [:find ?childUid ?childString ?childOrder
         :in $ ?parentUid
         :where
         [?parentEntity :block/uid ?parentUid]
         [?parentEntity :block/children ?childEntity] ; This ensures direct children
         [?childEntity :block/uid ?childUid]
         [?childEntity :block/string ?childString]
         [?childEntity :block/order ?childOrder]]
      `;

      const blockQuery = `
        [:find ?string
         :in $ ?uid
         :where
         [?e :block/uid ?uid]
         [?e :block/string ?string]]
      `;

      try {
        const blockStringResult = await q(this.graph, blockQuery, [blockUid]) as [string][];
        if (!blockStringResult || blockStringResult.length === 0) {
          return null;
        }
        const text = blockStringResult[0][0];

        const childrenResults = await q(this.graph, query, [blockUid]) as [string, string, number][];
        const children: NestedBlock[] = [];

        if (childrenResults && childrenResults.length > 0) {
          // Sort children by order
          const sortedChildren = childrenResults.sort((a, b) => a[2] - b[2]);

          for (const childResult of sortedChildren) {
            const childUid = childResult[0];
            const nestedChild = await fetchBlockWithChildren(childUid, level + 1);
            if (nestedChild) {
              children.push(nestedChild);
            }
          }
        }

        return { uid: blockUid, text, level, children: children.length > 0 ? children : undefined };
      } catch (error: any) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to fetch block with children for UID "${blockUid}": ${error.message}`
        );
      }
    };

    // Get or create the parent block
    let targetParentUid: string;
    if (!block_text_uid) {
      targetParentUid = targetPageUid;
    } else {
      try {
        if (isValidUid(block_text_uid)) {
          // First try to find block by UID
          const uidQuery = `[:find ?uid
                           :where [?e :block/uid "${block_text_uid}"]
                                  [?e :block/uid ?uid]]`;
          const uidResult = await q(this.graph, uidQuery, []) as [string][];
          
          if (uidResult && uidResult.length > 0) {
            // Use existing block if found
            targetParentUid = uidResult[0][0];
          } else {
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Block with UID "${block_text_uid}" not found`
            );
          }
        } else {
          // Create header block and get its UID if not a valid UID
          targetParentUid = await createAndVerifyBlock(block_text_uid, targetPageUid);
        }
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to ${isValidUid(block_text_uid) ? 'find' : 'create'} block "${block_text_uid}": ${errorMessage}`
        );
      }
    }

    // Initialize result variable
    let result;

    try {
      // Validate level sequence
      if (validOutline.length > 0 && validOutline[0].level !== 1) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Invalid outline structure - the first item must be at level 1'
        );
      }
      
      let prevLevel = 0;
      for (const item of validOutline) {
        // Level should not increase by more than 1 at a time
        if (item.level > prevLevel + 1) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Invalid outline structure - level ${item.level} follows level ${prevLevel}`
          );
        }
        prevLevel = item.level;
      }

      // Convert outline items to markdown-like structure
      const markdownContent = validOutline
        .map(item => {
          const indent = '  '.repeat(item.level - 1);
          // If the item text starts with a markdown heading (e.g., #, ##, ###),
          // treat it as a direct heading without adding a bullet or outline indentation.
          return `${indent}- ${item.text?.trim()}`;
        })
        .join('\n');

      // Convert to Roam markdown format
      const convertedContent = convertToRoamMarkdown(markdownContent);

      // Parse markdown into hierarchical structure
      // We pass the original OutlineItem properties (heading, children_view_type)
      // along with the parsed content to the nodes.
      const nodes = parseMarkdown(convertedContent).map((node, index) => ({
        ...node,
        ...(validOutline[index].heading && { heading_level: validOutline[index].heading }),
        ...(validOutline[index].children_view_type && { children_view_type: validOutline[index].children_view_type })
      }));

      // Convert nodes to batch actions
      const actions = convertToRoamActions(nodes, targetParentUid, 'first');

      if (actions.length === 0) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'No valid actions generated from outline'
        );
      }

      // Execute batch actions to create the outline
      result = await batchActions(this.graph, {
        action: 'batch-actions',
        actions
      }).catch(error => {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to create outline blocks: ${error.message}`
        );
      });

      if (!result) {
        throw new McpError(
          ErrorCode.InternalError,
          'Failed to create outline blocks - no result returned'
        );
      }
    } catch (error: any) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create outline: ${error.message}`
      );
    }

    // Post-creation verification to get actual UIDs for top-level blocks and their children
    const createdBlocks: NestedBlock[] = [];
    // Only query for top-level blocks (level 1) based on the original outline input
    const topLevelOutlineItems = validOutline.filter(item => item.level === 1);

    for (const item of topLevelOutlineItems) {
      try {
        // Assert item.text is a string as it's filtered earlier to be non-undefined and non-empty
        const foundUid = await findBlockWithRetry(targetParentUid, item.text!);
        if (foundUid) {
          const nestedBlock = await fetchBlockWithChildren(foundUid);
          if (nestedBlock) {
            createdBlocks.push(nestedBlock);
          }
        }
      } catch (error: any) {
        // This is a warning because even if one block fails to fetch, others might succeed.
        // The error will be logged but not re-thrown to allow partial success reporting.
        // console.warn(`Could not fetch nested block for "${item.text}": ${error.message}`);
      }
    }
    
    return {
      success: true,
      page_uid: targetPageUid,
      parent_uid: targetParentUid,
      created_uids: createdBlocks
    };
  }

  async importMarkdown(
    content: string,
    page_uid?: string,
    page_title?: string,
    parent_uid?: string,
    parent_string?: string,
    order: 'first' | 'last' = 'first'
  ): Promise<{ success: boolean; page_uid: string; parent_uid: string; created_uids?: string[] }> {
    // First get the page UID
    let targetPageUid = page_uid;
    
    if (!targetPageUid && page_title) {
      const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
      const findResults = await q(this.graph, findQuery, [page_title]) as [string][];
      
      if (findResults && findResults.length > 0) {
        targetPageUid = findResults[0][0];
      } else {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Page with title "${page_title}" not found`
        );
      }
    }

    // If no page specified, use today's date page
    if (!targetPageUid) {
      const today = new Date();
      const dateStr = formatRoamDate(today);
      
      const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
      const findResults = await q(this.graph, findQuery, [dateStr]) as [string][];
      
      if (findResults && findResults.length > 0) {
        targetPageUid = findResults[0][0];
      } else {
        // Create today's page
        try {
          await createPage(this.graph, {
            action: 'create-page',
            page: { title: dateStr }
          });

          const results = await q(this.graph, findQuery, [dateStr]) as [string][];
          if (!results || results.length === 0) {
            throw new McpError(
              ErrorCode.InternalError,
              'Could not find created today\'s page'
            );
          }
          targetPageUid = results[0][0];
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to create today's page: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    // Now get the parent block UID
    let targetParentUid = parent_uid;

    if (!targetParentUid && parent_string) {
      if (!targetPageUid) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Must provide either page_uid or page_title when using parent_string'
        );
      }

      // Find block by exact string match within the page
      const findBlockQuery = `[:find ?uid
                             :where [?p :block/uid "${targetPageUid}"]
                                    [?b :block/page ?p]
                                    [?b :block/string "${parent_string}"]]`;
      const blockResults = await q(this.graph, findBlockQuery, []) as [string][];
      
      if (!blockResults || blockResults.length === 0) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Block with content "${parent_string}" not found on specified page`
        );
      }
      
      targetParentUid = blockResults[0][0];
    }

    // If no parent specified, use page as parent
    if (!targetParentUid) {
      targetParentUid = targetPageUid;
    }

    // Always use parseMarkdown for content with multiple lines or any markdown formatting
    const isMultilined = content.includes('\n');
    
    if (isMultilined) {
      // Parse markdown into hierarchical structure
      const convertedContent = convertToRoamMarkdown(content);
      const nodes = parseMarkdown(convertedContent);

      // Convert markdown nodes to batch actions
      const actions = convertToRoamActions(nodes, targetParentUid, order);

      // Execute batch actions to add content
      const result = await batchActions(this.graph, {
        action: 'batch-actions',
        actions
      });

      if (!result) {
        throw new McpError(
          ErrorCode.InternalError,
          'Failed to import nested markdown content'
        );
      }

      // Get the created block UIDs
      const createdUids = result.created_uids || [];
      
      return { 
        success: true,
        page_uid: targetPageUid,
        parent_uid: targetParentUid,
        created_uids: createdUids
      };
    } else {
      // Create a simple block for non-nested content using batchActions
      const actions = [{
        action: 'create-block',
        location: { 
          "parent-uid": targetParentUid,
          order
        },
        block: { string: content }
      }];

      try {
        const result = await batchActions(this.graph, {
          action: 'batch-actions',
          actions
        });

        if (!result) {
          throw new McpError(
            ErrorCode.InternalError,
            'Failed to create content block via batch action'
          );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to create content block: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      return { 
        success: true,
        page_uid: targetPageUid,
        parent_uid: targetParentUid
      };
    }
  }
}
