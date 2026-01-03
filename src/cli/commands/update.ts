import { Command } from 'commander';
import { BatchOperations } from '../../tools/operations/batch.js';
import { printDebug, exitWithError } from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';

interface UpdateOptions extends GraphOptions {
  debug?: boolean;
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update a block\'s content by UID')
    .argument('<uid>', 'Block UID to update')
    .argument('<content>', 'New content for the block')
    .option('--debug', 'Show debug information')
    .option('-g, --graph <name>', 'Target graph key (for multi-graph mode)')
    .option('--write-key <key>', 'Write confirmation key (for non-default graphs)')
    .action(async (uid: string, content: string, options: UpdateOptions) => {
      try {
        // Strip (( )) wrapper if present
        const blockUid = uid.replace(/^\(\(|\)\)$/g, '');

        if (options.debug) {
          printDebug('Block UID', blockUid);
          printDebug('Graph', options.graph || 'default');
          printDebug('New content', content);
        }

        const graph = resolveGraph(options, true); // This is a write operation

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
