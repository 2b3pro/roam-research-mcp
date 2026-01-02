import { Command } from 'commander';
import { initializeGraph } from '@roam-research/roam-api-sdk';
import { API_TOKEN, GRAPH_NAME } from '../../config/environment.js';
import { BatchOperations } from '../../tools/operations/batch.js';
import { printDebug, exitWithError } from '../utils/output.js';

interface UpdateOptions {
  debug?: boolean;
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update a block\'s content by UID')
    .argument('<uid>', 'Block UID to update')
    .argument('<content>', 'New content for the block')
    .option('--debug', 'Show debug information')
    .action(async (uid: string, content: string, options: UpdateOptions) => {
      try {
        // Strip (( )) wrapper if present
        const blockUid = uid.replace(/^\(\(|\)\)$/g, '');

        if (options.debug) {
          printDebug('Block UID', blockUid);
          printDebug('New content', content);
        }

        const graph = initializeGraph({
          token: API_TOKEN,
          graph: GRAPH_NAME
        });

        const batchOps = new BatchOperations(graph);
        const result = await batchOps.processBatch([{
          action: 'update-block',
          uid: blockUid,
          string: content
        }]);

        if (result.success) {
          console.log(`Updated block ${blockUid}`);
        } else {
          const errorMsg = typeof result.error === 'string'
            ? result.error
            : result.error?.message || 'Unknown error';
          exitWithError(`Failed to update block: ${errorMsg}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
