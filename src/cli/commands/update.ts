import { Command } from 'commander';
import { BatchOperations } from '../../tools/operations/batch.js';
import { parseMarkdownHeadingLevel } from '../../markdown-utils.js';
import { printDebug, exitWithError } from '../utils/output.js';
import { resolveGraph, type GraphOptions } from '../utils/graph.js';

interface UpdateOptions extends GraphOptions {
  debug?: boolean;
  heading?: string;
  open?: boolean;
  closed?: boolean;
  todo?: boolean;
  done?: boolean;
  clearStatus?: boolean;
}

// Patterns for TODO/DONE markers (both {{TODO}} and {{[[TODO]]}} formats)
const TODO_PATTERN = /\{\{(\[\[)?TODO(\]\])?\}\}\s*/g;
const DONE_PATTERN = /\{\{(\[\[)?DONE(\]\])?\}\}\s*/g;
const ANY_STATUS_PATTERN = /\{\{(\[\[)?(TODO|DONE)(\]\])?\}\}\s*/g;

/**
 * Apply TODO/DONE status to content
 * - If target status marker exists, no change needed
 * - If opposite status exists, replace it
 * - If no status exists, prepend
 */
function applyStatus(content: string, status: 'TODO' | 'DONE'): string {
  const marker = `{{[[${status}]]}} `;
  const hasStatus = status === 'TODO'
    ? TODO_PATTERN.test(content)
    : DONE_PATTERN.test(content);

  // Reset regex lastIndex
  TODO_PATTERN.lastIndex = 0;
  DONE_PATTERN.lastIndex = 0;

  if (hasStatus) {
    return content; // Already has the target status
  }

  // Check for opposite status and replace
  const oppositePattern = status === 'TODO' ? DONE_PATTERN : TODO_PATTERN;
  if (oppositePattern.test(content)) {
    oppositePattern.lastIndex = 0;
    return content.replace(oppositePattern, marker);
  }

  // No status exists, prepend
  return marker + content;
}

/**
 * Remove any TODO/DONE status from content
 */
function clearStatus(content: string): string {
  return content.replace(ANY_STATUS_PATTERN, '').trim();
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update block content, heading, open/closed state, or TODO/DONE status')
    .argument('<uid>', 'Block UID to update (accepts ((uid)) wrapper)')
    .argument('<content>', 'New content. Use # prefix for heading: "# Title" sets H1')
    .option('-H, --heading <level>', 'Set heading level (1-3), or 0 to remove')
    .option('-o, --open', 'Expand block (show children)')
    .option('-c, --closed', 'Collapse block (hide children)')
    .option('-T, --todo', 'Set as TODO (replaces DONE if present, prepends if none)')
    .option('-D, --done', 'Set as DONE (replaces TODO if present, prepends if none)')
    .option('--clear-status', 'Remove TODO/DONE marker')
    .option('-g, --graph <name>', 'Target graph key (multi-graph mode)')
    .option('--write-key <key>', 'Write confirmation key (non-default graphs)')
    .option('--debug', 'Show debug information')
    .addHelpText('after', `
Examples:
  # Basic update
  roam update abc123def "New content"         # Update block text
  roam update "((abc123def))" "New content"   # UID with wrapper

  # Heading updates
  roam update abc123def "# Main Title"        # Auto-detect H1, strip #
  roam update abc123def "Title" -H 2          # Explicit H2
  roam update abc123def "Plain text" -H 0     # Remove heading

  # Block state
  roam update abc123def "Content" -o          # Expand block
  roam update abc123def "Content" -c          # Collapse block

  # TODO/DONE status
  roam update abc123def "Task" -T             # Set as TODO
  roam update abc123def "Task" -D             # Mark as DONE
  roam update abc123def "Task" --clear-status # Remove status marker
`)
    .action(async (uid: string, content: string, options: UpdateOptions) => {
      try {
        // Strip (( )) wrapper if present
        const blockUid = uid.replace(/^\(\(|\)\)$/g, '');

        // Detect heading from content unless explicitly set
        let finalContent = content;
        let headingLevel: number | undefined;

        if (options.heading !== undefined) {
          // Explicit heading option takes precedence
          const level = parseInt(options.heading, 10);
          if (level >= 0 && level <= 3) {
            headingLevel = level === 0 ? undefined : level;
            // Still strip # prefix if present for consistency
            const { content: stripped } = parseMarkdownHeadingLevel(content);
            finalContent = stripped;
          }
        } else {
          // Auto-detect heading from content
          const { heading_level, content: stripped } = parseMarkdownHeadingLevel(content);
          if (heading_level > 0) {
            headingLevel = heading_level;
            finalContent = stripped;
          }
        }

        // Handle open/closed state
        let openState: boolean | undefined;
        if (options.open) {
          openState = true;
        } else if (options.closed) {
          openState = false;
        }

        // Handle TODO/DONE status
        if (options.clearStatus) {
          finalContent = clearStatus(finalContent);
        } else if (options.todo) {
          finalContent = applyStatus(finalContent, 'TODO');
        } else if (options.done) {
          finalContent = applyStatus(finalContent, 'DONE');
        }

        if (options.debug) {
          printDebug('Block UID', blockUid);
          printDebug('Graph', options.graph || 'default');
          printDebug('Content', finalContent);
          printDebug('Heading level', headingLevel ?? 'none');
          printDebug('Open state', openState ?? 'unchanged');
          printDebug('Status', options.todo ? 'TODO' : options.done ? 'DONE' : options.clearStatus ? 'cleared' : 'unchanged');
        }

        const graph = resolveGraph(options, true); // This is a write operation

        const batchOps = new BatchOperations(graph);
        const result = await batchOps.processBatch([{
          action: 'update-block',
          uid: blockUid,
          string: finalContent,
          ...(headingLevel !== undefined && { heading: headingLevel }),
          ...(openState !== undefined && { open: openState })
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
