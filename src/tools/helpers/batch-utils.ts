import { rethrowRoamError } from '../../shared/errors.js';
/**
 * Shared utilities for batch operations with consistent error handling.
 */
import { Graph, batchActions } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export interface BatchAction {
  action?: string;
  [key: string]: any;
}

/**
 * Execute batch actions with consistent error handling.
 * Wraps batchActions call in try-catch and throws McpError on failure.
 *
 * @param graph - The Roam graph instance
 * @param actions - Array of batch actions to execute
 * @param errorContext - Description of what operation failed (e.g., "create memory block")
 * @returns The result from batchActions
 * @throws McpError if the operation fails
 */
export async function executeBatch(
  graph: Graph,
  actions: BatchAction[],
  errorContext: string
): Promise<any> {
  try {
    const result = await batchActions(graph, {
      action: 'batch-actions',
      actions
    });

    if (!result) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to ${errorContext}`
      );
    }

    return result;
  } catch (error) {
    rethrowRoamError(error);
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to ${errorContext}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Execute batch actions without throwing on failure (for non-critical operations).
 * Returns null on failure instead of throwing.
 *
 * @param graph - The Roam graph instance
 * @param actions - Array of batch actions to execute
 * @param errorContext - Description for logging on failure
 * @returns The result from batchActions, or null on failure
 */
export async function executeBatchSafe(
  graph: Graph,
  actions: BatchAction[],
  errorContext?: string
): Promise<any | null> {
  try {
    const result = await batchActions(graph, {
      action: 'batch-actions',
      actions
    });
    return result || null;
  } catch (error) {
    if (errorContext) {
      console.error(`Failed to ${errorContext}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}
