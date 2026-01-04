import { Command } from 'commander';
import { updatePage } from '@roam-research/roam-api-sdk';
import { printDebug, exitWithError } from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';

interface RenameOptions extends GraphOptions {
  debug?: boolean;
  uid?: string;
}

export function createRenameCommand(): Command {
  return new Command('rename')
    .description('Rename a page')
    .argument('<old-title>', 'Current page title (or use --uid for UID)')
    .argument('<new-title>', 'New page title')
    .option('-u, --uid <uid>', 'Use page UID instead of title')
    .option('-g, --graph <name>', 'Target graph key (multi-graph mode)')
    .option('--write-key <key>', 'Write confirmation key (non-default graphs)')
    .option('--debug', 'Show debug information')
    .addHelpText('after', `
Examples:
  # Rename by title
  roam rename "Old Page Name" "New Page Name"

  # Rename by UID
  roam rename --uid abc123def "New Page Name"

  # Multi-graph
  roam rename "Draft" "Published" -g work --write-key confirm
`)
    .action(async (oldTitle: string, newTitle: string, options: RenameOptions) => {
      try {
        if (options.debug) {
          printDebug('Old title', oldTitle);
          printDebug('New title', newTitle);
          printDebug('UID', options.uid || 'none (using title)');
          printDebug('Graph', options.graph || 'default');
        }

        const graph = resolveGraph(options, true); // Write operation

        // Build the page identifier
        const pageIdentifier = options.uid
          ? { uid: options.uid }
          : { title: oldTitle };

        if (options.debug) {
          printDebug('Page identifier', pageIdentifier);
        }

        const success = await updatePage(graph, {
          page: pageIdentifier,
          title: newTitle
        });

        if (success) {
          const identifier = options.uid ? `((${options.uid}))` : `"${oldTitle}"`;
          console.log(`Renamed ${identifier} → "${newTitle}"`);
        } else {
          exitWithError('Failed to rename page (API returned false)');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
