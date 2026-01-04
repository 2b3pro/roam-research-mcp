import { Command } from 'commander';
import { readFileSync } from 'fs';
import { BatchOperations } from '../../tools/operations/batch.js';
import { PageOperations } from '../../tools/operations/pages.js';
import { printDebug, exitWithError } from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';
import type { BatchCommand, PageCommand } from '../batch/types.js';
import type { BatchResult } from '../../tools/operations/batch.js';
import {
  collectPageTitles,
  resolveAllPages,
  resolveDailyPageUid,
  needsDailyPage,
  createResolutionContext,
  getDailyPageTitle
} from '../batch/resolver.js';
import { translateAllCommands } from '../batch/translator.js';

/**
 * Read all input from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

interface BatchOptions extends GraphOptions {
  debug?: boolean;
  dryRun?: boolean;
}

/**
 * Validate command structure
 */
function validateCommands(commands: unknown[]): commands is BatchCommand[] {
  const validCommandTypes = [
    'create', 'update', 'delete', 'move',
    'todo', 'table', 'outline', 'remember', 'page', 'codeblock'
  ];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i] as Record<string, unknown>;

    if (!cmd || typeof cmd !== 'object') {
      throw new Error(`Invalid command at index ${i}: must be an object`);
    }

    if (!cmd.command || typeof cmd.command !== 'string') {
      throw new Error(`Invalid command at index ${i}: missing 'command' field`);
    }

    if (!validCommandTypes.includes(cmd.command)) {
      throw new Error(`Invalid command at index ${i}: unknown command type '${cmd.command}'`);
    }

    if (!cmd.params || typeof cmd.params !== 'object') {
      throw new Error(`Invalid command at index ${i}: missing 'params' field`);
    }
  }

  return true;
}

export function createBatchCommand(): Command {
  return new Command('batch')
    .description('Execute multiple operations in a single batch API call')
    .argument('[file]', 'JSON file with commands (or pipe to stdin)')
    .option('--debug', 'Show debug information')
    .option('--dry-run', 'Validate and show planned actions without executing')
    .option('-g, --graph <name>', 'Target graph key (for multi-graph mode)')
    .option('--write-key <key>', 'Write confirmation key (for non-default graphs)')
    .action(async (file: string | undefined, options: BatchOptions) => {
      try {
        // Read input
        let rawInput: string;

        if (file) {
          try {
            rawInput = readFileSync(file, 'utf-8');
          } catch (err) {
            exitWithError(`Could not read file: ${file}`);
          }
        } else {
          if (process.stdin.isTTY) {
            exitWithError('No file specified and no input piped. Use: roam batch commands.json or cat commands.json | roam batch');
          }
          rawInput = await readStdin();
        }

        // Parse JSON
        let commands: unknown[];
        try {
          const parsed = JSON.parse(rawInput);
          if (!Array.isArray(parsed)) {
            exitWithError('Input must be a JSON array of commands');
          }
          commands = parsed;
        } catch (err) {
          if (err instanceof SyntaxError) {
            exitWithError(`Invalid JSON: ${err.message}`);
          }
          throw err;
        }

        if (commands.length === 0) {
          console.log('No commands to execute');
          return;
        }

        // Validate commands
        validateCommands(commands);

        if (options.debug) {
          printDebug('Commands', commands.length);
          printDebug('Graph', options.graph || 'default');
          printDebug('Dry run', options.dryRun || false);
        }

        const graph = resolveGraph(options, true); // Write operation

        // Phase 1: Collect and resolve page titles
        const context = createResolutionContext();
        const pageTitles = collectPageTitles(commands as BatchCommand[]);

        if (options.debug && pageTitles.size > 0) {
          printDebug('Page titles to resolve', Array.from(pageTitles));
        }

        // Resolve page titles in parallel
        if (pageTitles.size > 0) {
          const resolved = await resolveAllPages(graph, pageTitles);
          for (const [title, uid] of resolved) {
            context.pageUids.set(title, uid);
          }

          // Check for unresolved pages
          for (const title of pageTitles) {
            if (!context.pageUids.has(title)) {
              exitWithError(`Page not found: "${title}"`);
            }
          }

          if (options.debug) {
            printDebug('Resolved pages', Object.fromEntries(context.pageUids));
          }
        }

        // Resolve daily page if needed
        if (needsDailyPage(commands as BatchCommand[])) {
          const dailyUid = await resolveDailyPageUid(graph);
          if (!dailyUid) {
            exitWithError(`Daily page not found: "${getDailyPageTitle()}"`);
          }
          context.dailyPageUid = dailyUid;
          context.pageUids.set(getDailyPageTitle(), dailyUid);

          if (options.debug) {
            printDebug('Daily page UID', dailyUid);
          }
        }

        // Phase 2: Translate commands to batch actions
        const { actions, pageCommands } = translateAllCommands(
          commands as BatchCommand[],
          context
        );

        if (options.debug) {
          printDebug('Batch actions', actions.length);
          printDebug('Page commands', pageCommands.length);
          if (actions.length > 0) {
            printDebug('First action', JSON.stringify(actions[0], null, 2));
          }
        }

        // Dry run: show actions and exit
        if (options.dryRun) {
          console.log('\n[DRY RUN] Planned actions:\n');

          if (pageCommands.length > 0) {
            console.log('Page creations:');
            for (const pc of pageCommands) {
              console.log(`  - Create page: "${pc.params.title}"`);
            }
            console.log('');
          }

          console.log('Batch actions:');
          for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            console.log(`  ${i + 1}. ${action.action}`);
            if (action.string) {
              const preview = action.string.length > 50
                ? action.string.substring(0, 50) + '...'
                : action.string;
              console.log(`     text: "${preview}"`);
            }
            if (action.location) {
              console.log(`     parent: ${action.location['parent-uid']}`);
            }
            if (action.uid) {
              console.log(`     uid: ${action.uid}`);
            }
          }

          console.log(`\nTotal: ${pageCommands.length} page(s), ${actions.length} action(s)`);
          return;
        }

        // Phase 3: Execute page commands first (separate API calls)
        const pageResults: Array<{ title: string; uid: string }> = [];
        if (pageCommands.length > 0) {
          const pageOps = new PageOperations(graph);

          for (const pc of pageCommands) {
            const result = await pageOps.createPage(
              pc.params.title,
              pc.params.content?.map(item => ({
                text: item.text,
                level: item.level,
                heading: item.heading
              }))
            );

            if (result.success) {
              pageResults.push({ title: pc.params.title, uid: result.uid });

              // Register placeholder if 'as' is specified
              if (pc.params.as) {
                context.placeholders.set(pc.params.as, result.uid);
              }

              if (options.debug) {
                printDebug(`Created page "${pc.params.title}"`, result.uid);
              }
            } else {
              exitWithError(`Failed to create page "${pc.params.title}"`);
            }
          }
        }

        // Phase 4: Execute batch actions
        let batchResult: BatchResult = { success: true, actions_attempted: 0 };

        if (actions.length > 0) {
          const batchOps = new BatchOperations(graph);
          batchResult = await batchOps.processBatch(actions);

          if (!batchResult.success) {
            const errorMsg = typeof batchResult.error === 'string'
              ? batchResult.error
              : batchResult.error?.message || 'Unknown error';
            exitWithError(`Batch execution failed: ${errorMsg}`);
          }
        }

        // Output results
        const output: Record<string, unknown> = {
          success: true,
          pages_created: pageResults.length,
          actions_executed: actions.length
        };

        // Build uid_map combining pages and placeholders
        const uidMap: Record<string, string> = {};

        for (const pr of pageResults) {
          // Find the 'as' name for this page
          const pageCmd = pageCommands.find(pc => pc.params.title === pr.title);
          if (pageCmd?.params.as) {
            uidMap[pageCmd.params.as] = pr.uid;
          }
        }

        if (batchResult.uid_map) {
          Object.assign(uidMap, batchResult.uid_map);
        }

        if (Object.keys(uidMap).length > 0) {
          output.uid_map = uidMap;
        }

        console.log(JSON.stringify(output, null, 2));

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
