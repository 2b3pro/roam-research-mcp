import { Command } from 'commander';
import { PageOperations } from '../../tools/operations/pages.js';
import { printDebug, exitWithError } from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';

interface RenameOptions extends GraphOptions {
  debug?: boolean;
  uid?: string;
}

export function createRenameCommand(): Command {
  return new Command('rename')
    .description('Rename a page')
    .argument('<old-title>', 'Current page title (leave out when using --uid)')
    .argument('[new-title]', 'New page title')
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
    .action(async (first: string, second: string | undefined, options: RenameOptions, command: Command) => {
      // --uid already names the page, so a lone argument is the new title.
      const newTitle = second ?? (options.uid ? first : undefined);
      if (newTitle === undefined) {
        command.error("error: missing required argument 'new-title'");
      }
      const oldTitle = options.uid ? undefined : first;

      try {
        if (options.debug) {
          printDebug('Old title', oldTitle ?? 'none (using UID)');
          printDebug('New title', newTitle);
          printDebug('UID', options.uid || 'none (using title)');
          printDebug('Graph', options.graph || 'default');
        }

        const graph = resolveGraph(options, true); // Write operation

        const result = await new PageOperations(graph).renamePage({
          old_title: oldTitle,
          uid: options.uid,
          new_title: newTitle
        });

        if (result.success) {
          console.log(result.message);
        } else {
          exitWithError(result.message);
        }
      } catch (error) {
        exitWithError(error);
      }
    });
}
