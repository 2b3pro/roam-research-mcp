import { Graph, q, createBlock as createRoamBlock, updateBlock as updateRoamBlock, batchActions, createPage } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { formatRoamDate } from '../../utils/helpers.js';
import { 
  parseMarkdown, 
  convertToRoamActions,
  convertToRoamMarkdown,
  hasMarkdownTable,
  type BatchAction 
} from '../../markdown-utils.js';
import type { BlockUpdate, BlockUpdateResult } from '../types/index.js';

export class BlockOperations {
  constructor(private graph: Graph) {}

  async createBlock(content: string, page_uid?: string, title?: string, heading?: number): Promise<{ success: boolean; block_uid?: string; parent_uid: string }> {
    // If page_uid provided, use it directly
    let targetPageUid = page_uid;
    
    // If no page_uid but title provided, search for page by title
    if (!targetPageUid && title) {
      const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
      const findResults = await q(this.graph, findQuery, [title]) as [string][];
      
      if (findResults && findResults.length > 0) {
        targetPageUid = findResults[0][0];
      } else {
        // Create page with provided title if it doesn't exist
        try {
          await createPage(this.graph, {
            action: 'create-page',
            page: { title }
          });

          // Get the new page's UID
          const results = await q(this.graph, findQuery, [title]) as [string][];
          if (!results || results.length === 0) {
            throw new Error('Could not find created page');
          }
          targetPageUid = results[0][0];
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to create page: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
    
    // If neither page_uid nor title provided, use today's date page
    if (!targetPageUid) {
      const today = new Date();
      const dateStr = formatRoamDate(today);
      
      // Try to find today's page
      const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
      const findResults = await q(this.graph, findQuery, [dateStr]) as [string][];
      
      if (findResults && findResults.length > 0) {
        targetPageUid = findResults[0][0];
      } else {
        // Create today's page if it doesn't exist
        try {
          await createPage(this.graph, {
            action: 'create-page',
            page: { title: dateStr }
          });

          // Get the new page's UID
          const results = await q(this.graph, findQuery, [dateStr]) as [string][];
          if (!results || results.length === 0) {
            throw new Error('Could not find created today\'s page');
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

    try {
      // If the content has multiple lines or is a table, use nested import
      if (content.includes('\n')) {
        let nodes;
        
        // If heading parameter is provided, manually construct nodes to preserve heading
        if (heading) {
          const lines = content.split('\n');
          const firstLine = lines[0].trim();
          const remainingLines = lines.slice(1);
          
          // Create the first node with heading formatting
          const firstNode = {
            content: firstLine,
            level: 0,
            heading_level: heading,
            children: []
          };
          
          // If there are remaining lines, parse them as children or siblings
          if (remainingLines.length > 0 && remainingLines.some(line => line.trim())) {
            const remainingContent = remainingLines.join('\n');
            const convertedRemainingContent = convertToRoamMarkdown(remainingContent);
            const remainingNodes = parseMarkdown(convertedRemainingContent);
            
            // Add remaining nodes as siblings to the first node
            nodes = [firstNode, ...remainingNodes];
          } else {
            nodes = [firstNode];
          }
        } else {
          // No heading parameter, use original parsing logic
          const convertedContent = convertToRoamMarkdown(content);
          nodes = parseMarkdown(convertedContent);
        }
        
        const actions = convertToRoamActions(nodes, targetPageUid, 'last');
        
        // Execute batch actions to create the nested structure
        const result = await batchActions(this.graph, {
          action: 'batch-actions',
          actions
        });

        if (!result) {
          throw new Error('Failed to create nested blocks');
        }

        const blockUid = result.created_uids?.[0];
        return { 
          success: true,
          block_uid: blockUid,
          parent_uid: targetPageUid!
        };
      } else {
        // For single block content, use the same convertToRoamActions approach that works in roam_create_page
        const nodes = [{
          content: content,
          level: 0,
          ...(heading && typeof heading === 'number' && heading > 0 && { heading_level: heading }),
          children: []
        }];
        
        if (!targetPageUid) {
          throw new McpError(ErrorCode.InternalError, 'targetPageUid is undefined');
        }
        
        const actions = convertToRoamActions(nodes, targetPageUid, 'last');
        
        // Execute batch actions to create the block
        const result = await batchActions(this.graph, {
          action: 'batch-actions',
          actions
        });

        if (!result) {
          throw new Error('Failed to create block');
        }

        const blockUid = result.created_uids?.[0];
        return { 
          success: true,
          block_uid: blockUid,
          parent_uid: targetPageUid!
        };
      }
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create block: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateBlock(block_uid: string, content?: string, transform?: (currentContent: string) => string): Promise<{ success: boolean; content: string }> {
    if (!block_uid) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'block_uid is required'
      );
    }

    // Get current block content
    const blockQuery = `[:find ?string .
                        :where [?b :block/uid "${block_uid}"]
                               [?b :block/string ?string]]`;
    const result = await q(this.graph, blockQuery, []);
    if (result === null || result === undefined) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Block with UID "${block_uid}" not found`
      );
    }
    const currentContent = String(result);
    
    if (currentContent === null || currentContent === undefined) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Block with UID "${block_uid}" not found`
      );
    }

    // Determine new content
    let newContent: string;
    if (content) {
      newContent = content;
    } else if (transform) {
      newContent = transform(currentContent);
    } else {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Either content or transform function must be provided'
      );
    }

    try {
      await updateRoamBlock(this.graph, {
        action: 'update-block',
        block: {
          uid: block_uid,
          string: newContent
        }
      });

      return { 
        success: true,
        content: newContent
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update block: ${error.message}`
      );
    }
  }

  async updateBlocks(updates: BlockUpdate[]): Promise<{ success: boolean; results: BlockUpdateResult[] }> {
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'updates must be a non-empty array'
      );
    }

    // Validate each update has required fields
    updates.forEach((update, index) => {
      if (!update.block_uid) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Update at index ${index} missing block_uid`
        );
      }
      if (!update.content && !update.transform) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Update at index ${index} must have either content or transform`
        );
      }
    });

    // Get current content for all blocks
    const blockUids = updates.map(u => u.block_uid);
    const blockQuery = `[:find ?uid ?string
                        :in $ [?uid ...]
                        :where [?b :block/uid ?uid]
                               [?b :block/string ?string]]`;
    const blockResults = await q(this.graph, blockQuery, [blockUids]) as [string, string][];
    
    // Create map of uid -> current content
    const contentMap = new Map<string, string>();
    blockResults.forEach(([uid, string]) => {
      contentMap.set(uid, string);
    });

    // Prepare batch actions
    const actions: BatchAction[] = [];
    const results: BlockUpdateResult[] = [];

    for (const update of updates) {
      try {
        const currentContent = contentMap.get(update.block_uid);
        if (!currentContent) {
          results.push({
            block_uid: update.block_uid,
            content: '',
            success: false,
            error: `Block with UID "${update.block_uid}" not found`
          });
          continue;
        }

        // Determine new content
        let newContent: string;
        if (update.content) {
          newContent = update.content;
        } else if (update.transform) {
          const regex = new RegExp(update.transform.find, update.transform.global ? 'g' : '');
          newContent = currentContent.replace(regex, update.transform.replace);
        } else {
          // This shouldn't happen due to earlier validation
          throw new Error('Invalid update configuration');
        }

        // Add to batch actions
        actions.push({
          action: 'update-block',
          block: {
            uid: update.block_uid,
            string: newContent
          }
        });

        results.push({
          block_uid: update.block_uid,
          content: newContent,
          success: true
        });
      } catch (error: any) {
        results.push({
          block_uid: update.block_uid,
          content: contentMap.get(update.block_uid) || '',
          success: false,
          error: error.message
        });
      }
    }

    // Execute batch update if we have any valid actions
    if (actions.length > 0) {
      try {
        const batchResult = await batchActions(this.graph, {
          action: 'batch-actions',
          actions
        });

        if (!batchResult) {
          throw new Error('Batch update failed');
        }
      } catch (error: any) {
        // Mark all previously successful results as failed
        results.forEach(result => {
          if (result.success) {
            result.success = false;
            result.error = `Batch update failed: ${error.message}`;
          }
        });
      }
    }

    return {
      success: results.every(r => r.success),
      results
    };
  }
}
