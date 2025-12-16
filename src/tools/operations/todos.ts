import { Graph, q, createBlock, createPage, batchActions } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { formatRoamDate } from '../../utils/helpers.js';

export class TodoOperations {
  constructor(private graph: Graph) {}

  async addTodos(todos: string[]): Promise<{ success: boolean }> {
    if (!Array.isArray(todos) || todos.length === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'todos must be a non-empty array'
      );
    }

    // Get today's date
    const today = new Date();
    const dateStr = formatRoamDate(today);
    
    // Try to find today's page
    const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
    const findResults = await q(this.graph, findQuery, [dateStr]) as [string][];
    
    let targetPageUid: string;
    
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
        throw new Error('Failed to create today\'s page');
      }
    }

    const todo_tag = "{{TODO}}";
    const actions = todos.map((todo, index) => ({
      action: 'create-block',
      location: {
        'parent-uid': targetPageUid,
        order: index
      },
      block: {
        string: `${todo_tag} ${todo}`
      }
    }));

    const result = await batchActions(this.graph, {
      action: 'batch-actions',
      actions
    });

    if (!result) {
      throw new Error('Failed to create todo blocks');
    }
    
    return { success: true };
  }
}
