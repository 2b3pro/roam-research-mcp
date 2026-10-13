import { Graph, q, moveBlock as moveRoamBlock } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ednString } from '../../shared/datalog.js';

export class BlockOperations {
  constructor(private graph: Graph) {}

  async moveBlock(
    block_uid: string,
    parent_uid: string,
    order: number | 'first' | 'last' = 'last'
  ): Promise<{ success: boolean; block_uid: string; new_parent_uid: string; order: number | string }> {
    if (!block_uid) {
      throw new McpError(ErrorCode.InvalidRequest, 'block_uid is required');
    }
    if (!parent_uid) {
      throw new McpError(ErrorCode.InvalidRequest, 'parent_uid is required');
    }

    // Verify the block exists
    const blockQuery = `[:find ?uid .
                        :where [?b :block/uid ${ednString(block_uid)}]
                               [?b :block/uid ?uid]]`;
    const blockExists = await q(this.graph, blockQuery, []);
    if (!blockExists) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Block with UID "${block_uid}" not found`
      );
    }

    try {
      await moveRoamBlock(this.graph, {
        action: 'move-block',
        location: {
          'parent-uid': parent_uid,
          order: order
        },
        block: {
          uid: block_uid
        }
      });

      return {
        success: true,
        block_uid,
        new_parent_uid: parent_uid,
        order
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to move block: ${error.message}`
      );
    }
  }
}
