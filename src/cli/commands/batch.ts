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
import { readStdin } from '../utils/input.js';

interface BatchOptions extends GraphOptions {
  debug?: boolean;
  dryRun?: boolean;
  simulate?: boolean;
}

// Required params per command type
const REQUIRED_PARAMS: Record<string, string[]> = {
  todo: ['text'],
  create: ['parent', 'text'],
  update: ['uid'],
  delete: ['uid'],
  move: ['uid', 'parent'],
  page: ['title'],
  outline: ['parent', 'items'],
  table: ['parent', 'headers', 'rows'],
  remember: ['text'],
  codeblock: ['parent', 'code']
};

const VALID_COMMAND_TYPES = Object.keys(REQUIRED_PARAMS);

/**
 * Validate command structure and required params
 */
function validateCommands(commands: unknown[]): BatchCommand[] {
  const validated: BatchCommand[] = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i] as Record<string, unknown>;

    if (!cmd || typeof cmd !== 'object') {
      throw new Error(`[${i}] Command must be an object`);
    }

    if (!cmd.command || typeof cmd.command !== 'string') {
      throw new Error(`[${i}] Missing 'command' field`);
    }

    const cmdType = cmd.command;
    if (!VALID_COMMAND_TYPES.includes(cmdType)) {
      throw new Error(`[${i}] Unknown command type '${cmdType}'. Valid: ${VALID_COMMAND_TYPES.join(', ')}`);
    }

    if (!cmd.params || typeof cmd.params !== 'object') {
      throw new Error(`[${i}] Missing 'params' field`);
    }

    // Check required params
    const params = cmd.params as Record<string, unknown>;
    const required = REQUIRED_PARAMS[cmdType];
    for (const param of required) {
      if (params[param] === undefined) {
        throw new Error(`[${i}] ${cmdType}: missing required param '${param}'`);
      }
    }

    validated.push(cmd as unknown as BatchCommand);
  }

  return validated;
}

/**
 * Validate placeholder references are defined before use
 * Returns list of errors (empty = valid)
 */
function validatePlaceholders(commands: BatchCommand[]): string[] {
  const errors: string[] = [];
  const definedPlaceholders = new Set<string>();

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const params = cmd.params as Record<string, unknown>;

    // Collect placeholder definitions from 'as' params
    if (typeof params.as === 'string') {
      definedPlaceholders.add(params.as);
    }

    // Check placeholder references in 'parent' param
    if (typeof params.parent === 'string') {
      const match = params.parent.match(/^\{\{(\w+)\}\}$/);
      if (match) {
        const refName = match[1];
        if (!definedPlaceholders.has(refName)) {
          errors.push(`[${i}] ${cmd.command}: placeholder "{{${refName}}}" used before definition`);
        }
      }
    }
  }

  return errors;
}

/**
 * Output partial results when a failure occurs mid-batch
 * Helps user know what was created and may need manual cleanup
 */
function outputPartialResults(
  pageResults: Array<{ title: string; uid: string }>,
  failedPage?: string,
  batchError?: string
): never {
  const output: Record<string, unknown> = {
    success: false,
    partial: true,
    pages_created: pageResults.length,
    ...(failedPage && { failed_at: `page: ${failedPage}` }),
    ...(batchError && { failed_at: `batch: ${batchError}` })
  };

  if (pageResults.length > 0) {
    output.created_pages = pageResults.map(p => ({
      title: p.title,
      uid: p.uid
    }));
    output.cleanup_hint = 'Pages listed above were created before failure. Delete manually if needed.';
  }

  console.error(JSON.stringify(output, null, 2));
  process.exit(1);
}

/** Format action for dry-run display */
function formatAction(action: Record<string, unknown>, index: number): string {
  const lines: string[] = [`  ${index + 1}. ${action.action}`];

  if (action.string) {
    const text = String(action.string);
    const preview = text.length > 60 ? text.slice(0, 60) + '...' : text;
    lines.push(`     text: "${preview}"`);
  }
  if (action.location) {
    const loc = action.location as Record<string, unknown>;
    lines.push(`     parent: ${loc['parent-uid']}`);
  }
  if (action.uid) {
    lines.push(`     uid: ${action.uid}`);
  }

  return lines.join('\n');
}

export function createBatchCommand(): Command {
  return new Command('batch')
    .description('Execute multiple block operations efficiently in a single API call')
    .argument('[file]', 'JSON file with commands (or pipe via stdin)')
    .option('--debug', 'Show debug information')
    .option('--dry-run', 'Validate and show planned actions without executing')
    .option('--simulate', 'Validate structure offline (no API calls)')
    .option('-g, --graph <name>', 'Target graph key (for multi-graph mode)')
    .option('--write-key <key>', 'Write confirmation key (for non-default graphs)')
    .addHelpText('after', `
Examples:
  # From file
  roam batch commands.json                # Execute commands from file
  roam batch commands.json --dry-run      # Preview without executing (resolves pages)
  roam batch commands.json --simulate     # Validate offline (no API calls)

  # From stdin
  cat commands.json | roam batch          # Pipe commands
  echo '[{"command":"todo","params":{"text":"Task 1"}}]' | roam batch

Command schemas:
  todo:      {text}
  create:    {parent, text, as?, heading?, order?}
  update:    {uid, text?, heading?, open?}
  delete:    {uid}
  move:      {uid, parent, order?}
  page:      {title, as?, content?: [{text, level, heading?}...]}
  outline:   {parent, items: [string...]}
  table:     {parent, headers: [string...], rows: [{label, cells: [string...]}...]}
  remember:  {text, categories?: [string...]}
  codeblock: {parent, code, language?}

Parent accepts: block UID, "daily", page title, or {{placeholder}}

Example:
  [
    {"command": "page", "params": {"title": "Project X", "as": "proj"}},
    {"command": "create", "params": {"parent": "{{proj}}", "text": "# Overview", "as": "overview"}},
    {"command": "outline", "params": {"parent": "{{overview}}", "items": ["Goal 1", "Goal 2"]}},
    {"command": "todo", "params": {"text": "Review project"}}
  ]

Output (JSON): { success, pages_created, actions_executed, uid_map? }
`)
    .action(async (file: string | undefined, options: BatchOptions) => {
      try {
        // Read input
        let rawInput: string;
        if (file) {
          try {
            rawInput = readFileSync(file, 'utf-8');
          } catch {
            exitWithError(`Could not read file: ${file}`);
          }
        } else if (process.stdin.isTTY) {
          exitWithError('No file specified and no input piped. Use: roam batch commands.json or cat commands.json | roam batch');
        } else {
          rawInput = await readStdin();
        }

        // Parse JSON
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawInput!);
        } catch (err) {
          exitWithError(`Invalid JSON: ${err instanceof SyntaxError ? err.message : 'parse error'}`);
        }

        if (!Array.isArray(parsed)) {
          exitWithError('Input must be a JSON array of commands');
        }

        if (parsed.length === 0) {
          console.log('No commands to execute');
          return;
        }

        // Validate and get typed commands
        const commands = validateCommands(parsed);

        // Upfront validation: check placeholder references
        const placeholderErrors = validatePlaceholders(commands);
        if (placeholderErrors.length > 0) {
          exitWithError(`Placeholder validation failed:\n  ${placeholderErrors.join('\n  ')}`);
        }

        if (options.debug) {
          printDebug('Commands', commands.length);
          printDebug('Graph', options.graph || 'default');
          printDebug('Mode', options.simulate ? 'simulate' : options.dryRun ? 'dry-run' : 'execute');
        }

        // Simulate mode: validate structure without connecting to Roam
        if (options.simulate) {
          const context = createResolutionContext();
          const { actions, pageCommands } = translateAllCommands(commands, context);

          console.log('\n[SIMULATE] Validation passed\n');
          console.log(`Commands: ${commands.length}`);
          console.log(`  Pages to create: ${pageCommands.length}`);
          console.log(`  Batch actions: ${actions.length}`);

          if (pageCommands.length > 0) {
            console.log('\nPage creations:');
            for (const pc of pageCommands) {
              const as = pc.params.as ? ` → {{${pc.params.as}}}` : '';
              console.log(`  - "${pc.params.title}"${as}`);
            }
          }

          console.log('\nNo API calls made. Use --dry-run to resolve page UIDs.');
          return;
        }

        const graph = resolveGraph(options, true);

        // Phase 1: Collect and resolve page titles
        const context = createResolutionContext();
        const pageTitles = collectPageTitles(commands);

        if (pageTitles.size > 0) {
          if (options.debug) {
            printDebug('Pages to resolve', Array.from(pageTitles));
          }

          const resolved = await resolveAllPages(graph, pageTitles);
          for (const [title, uid] of resolved) {
            context.pageUids.set(title, uid);
          }

          // Check for unresolved pages
          const unresolved = Array.from(pageTitles).filter(t => !context.pageUids.has(t));
          if (unresolved.length > 0) {
            exitWithError(`Page(s) not found: ${unresolved.map(t => `"${t}"`).join(', ')}`);
          }

          if (options.debug) {
            printDebug('Resolved pages', Object.fromEntries(context.pageUids));
          }
        }

        // Resolve daily page if needed
        if (needsDailyPage(commands)) {
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
        const { actions, pageCommands } = translateAllCommands(commands, context);

        if (options.debug) {
          printDebug('Batch actions', actions.length);
          printDebug('Page commands', pageCommands.length);
        }

        // Dry run: show actions and exit
        if (options.dryRun) {
          console.log('\n[DRY RUN] Planned actions:\n');

          if (pageCommands.length > 0) {
            console.log('Page creations:');
            for (const pc of pageCommands) {
              const as = pc.params.as ? ` (as: {{${pc.params.as}}})` : '';
              console.log(`  - "${pc.params.title}"${as}`);
            }
            console.log('');
          }

          if (actions.length > 0) {
            console.log('Batch actions:');
            console.log(actions.map((a, i) => formatAction(a as unknown as Record<string, unknown>, i)).join('\n'));
          }

          console.log(`\nTotal: ${pageCommands.length} page(s), ${actions.length} action(s)`);
          return;
        }

        // Phase 3: Execute page commands (in parallel where possible)
        const pageResults: Array<{ title: string; uid: string }> = [];
        if (pageCommands.length > 0) {
          const pageOps = new PageOperations(graph);

          // Execute page creations - must be sequential if they reference each other
          for (const pc of pageCommands) {
            const result = await pageOps.createPage(
              pc.params.title,
              pc.params.content?.map(item => ({
                text: item.text,
                level: item.level,
                heading: item.heading
              }))
            );

            if (!result.success) {
              // Report partial results before exiting
              outputPartialResults(pageResults, pc.params.title);
            }

            pageResults.push({ title: pc.params.title, uid: result.uid });

            if (pc.params.as) {
              context.placeholders.set(pc.params.as, result.uid);
            }

            if (options.debug) {
              printDebug(`Created "${pc.params.title}"`, result.uid);
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
            // Report partial results (pages created before batch failed)
            outputPartialResults(pageResults, undefined, errorMsg);
          }
        }

        // Build output
        const uidMap: Record<string, string> = {};

        for (const pr of pageResults) {
          const pageCmd = pageCommands.find(pc => pc.params.title === pr.title);
          if (pageCmd?.params.as) {
            uidMap[pageCmd.params.as] = pr.uid;
          }
        }

        if (batchResult.uid_map) {
          Object.assign(uidMap, batchResult.uid_map);
        }

        const output: Record<string, unknown> = {
          success: true,
          pages_created: pageResults.length,
          actions_executed: actions.length,
          ...(Object.keys(uidMap).length > 0 && { uid_map: uidMap })
        };

        console.log(JSON.stringify(output, null, 2));

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        exitWithError(message);
      }
    });
}
