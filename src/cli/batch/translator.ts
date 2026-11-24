/**
 * Translator: converts CLI-style commands to Roam batch actions
 */

import type {
  BatchCommand,
  BatchAction,
  ResolutionContext,
  CreateCommand,
  UpdateCommand,
  DeleteCommand,
  MoveCommand,
  TodoCommand,
  TableCommand,
  OutlineCommand,
  OutlineItem,
  RememberCommand,
  PageCommand,
  CodeblockCommand
} from './types.js';
import {
  resolveParentRef,
  generatePlaceholder,
  getDailyPageTitle
} from './resolver.js';
import { sanitizeTagName } from '../../utils/helpers.js';

/**
 * Translate a single command to batch actions
 * May return multiple actions (e.g., table, outline)
 */
export function translateCommand(
  command: BatchCommand,
  context: ResolutionContext
): BatchAction[] {
  switch (command.command) {
    case 'create':
      return translateCreate(command, context);
    case 'update':
      return translateUpdate(command);
    case 'delete':
      return translateDelete(command);
    case 'move':
      return translateMove(command, context);
    case 'todo':
      return translateTodo(command, context);
    case 'table':
      return translateTable(command, context);
    case 'outline':
      return translateOutline(command, context);
    case 'remember':
      return translateRemember(command, context);
    case 'page':
      return translatePage(command, context);
    case 'codeblock':
      return translateCodeblock(command, context);
    default:
      throw new Error(`Unknown command: ${(command as any).command}`);
  }
}

/**
 * Resolve parent UID from command params
 */
function getParentUid(
  params: { parent?: string; page?: string; pageUid?: string },
  context: ResolutionContext
): string {
  // Direct parent UID or placeholder
  if (params.parent) {
    const resolved = resolveParentRef(params.parent, context);
    if (resolved) return resolved;
    throw new Error(`Parent "${params.parent}" could not be resolved to a UID. Page may not exist.`);
  }

  // Page UID
  if (params.pageUid) {
    return params.pageUid;
  }

  // Page title -> resolved UID
  if (params.page) {
    const uid = context.pageUids.get(params.page);
    if (!uid) {
      throw new Error(`Page "${params.page}" not found`);
    }
    return uid;
  }

  // Default to daily page
  if (context.dailyPageUid) {
    return context.dailyPageUid;
  }

  throw new Error('No parent specified and daily page not resolved');
}

/**
 * Register a placeholder in the context
 */
function registerPlaceholder(name: string, context: ResolutionContext): string {
  const placeholder = generatePlaceholder(name);
  context.placeholders.set(name, placeholder);
  return placeholder;
}

/**
 * Update level stack for hierarchy tracking
 */
function updateLevelStack(level: number, uid: string, context: ResolutionContext): void {
  // Ensure stack is long enough
  while (context.levelStack.length < level) {
    context.levelStack.push('');
  }
  context.levelStack[level - 1] = uid;
  // Truncate stack above current level
  context.levelStack.length = level;
}

/**
 * Get parent from level stack for hierarchical nesting
 */
function getParentFromLevel(level: number, context: ResolutionContext): string | null {
  if (level <= 1) {
    return context.currentParent;
  }
  const parentLevel = level - 1;
  if (parentLevel <= context.levelStack.length && context.levelStack[parentLevel - 1]) {
    return context.levelStack[parentLevel - 1];
  }
  return context.currentParent;
}

// --- Command translators ---

function translateCreate(cmd: CreateCommand, context: ResolutionContext): BatchAction[] {
  const { params } = cmd;
  let parentUid: string;

  // Handle level-based hierarchy
  if (params.level !== undefined && params.level > 1) {
    const levelParent = getParentFromLevel(params.level, context);
    if (levelParent) {
      parentUid = levelParent;
    } else {
      parentUid = getParentUid(params, context);
    }
  } else {
    parentUid = getParentUid(params, context);
    // Set as current parent for level-based children
    if (params.level === 1 || params.level === undefined) {
      context.currentParent = parentUid;
    }
  }

  const action: BatchAction = {
    action: 'create-block',
    string: params.text,
    location: {
      'parent-uid': parentUid,
      order: params.order ?? 'last'
    }
  };

  // Register placeholder if 'as' is specified
  if (params.as) {
    action.uid = registerPlaceholder(params.as, context);
  }

  // Optional properties
  if (params.heading) {
    action.heading = params.heading;
  }
  if (params['children-view-type']) {
    action['children-view-type'] = params['children-view-type'];
  }

  // Update level stack if level is specified
  if (params.level !== undefined && params.as) {
    updateLevelStack(params.level, `{{uid:${params.as}}}`, context);
  }

  return [action];
}

function translateUpdate(cmd: UpdateCommand): BatchAction[] {
  const { params } = cmd;

  const action: BatchAction = {
    action: 'update-block',
    uid: params.uid,
    string: params.text
  };

  if (params.heading !== undefined) {
    action.heading = params.heading;
  }
  if (params.open !== undefined) {
    action.open = params.open;
  }
  if (params['text-align']) {
    action['text-align'] = params['text-align'];
  }
  if (params['children-view-type']) {
    action['children-view-type'] = params['children-view-type'];
  }

  return [action];
}

function translateDelete(cmd: DeleteCommand): BatchAction[] {
  return [{
    action: 'delete-block',
    uid: cmd.params.uid
  }];
}

function translateMove(cmd: MoveCommand, context: ResolutionContext): BatchAction[] {
  const { params } = cmd;

  return [{
    action: 'move-block',
    uid: params.uid,
    location: {
      // Resolved like every other parent. Passed through raw, a page title or
      // "daily" reached the batch as a "UID" and was refused there.
      'parent-uid': getParentUid({ parent: params.parent }, context),
      order: params.order ?? 'last'
    }
  }];
}

function translateTodo(cmd: TodoCommand, context: ResolutionContext): BatchAction[] {
  const { params } = cmd;
  const parentUid = getParentUid(params, context);

  const action: BatchAction = {
    action: 'create-block',
    string: `{{[[TODO]]}} ${params.text}`,
    location: {
      'parent-uid': parentUid,
      order: params.order ?? 'last'
    }
  };

  if (params.as) {
    action.uid = registerPlaceholder(params.as, context);
  }

  return [action];
}

function translateTable(cmd: TableCommand, context: ResolutionContext): BatchAction[] {
  const { params } = cmd;
  const parentUid = getParentUid(params, context);
  const actions: BatchAction[] = [];

  // Table container
  const tableContainerPlaceholder = params.as
    ? registerPlaceholder(params.as, context)
    : registerPlaceholder(`_table_${Date.now()}`, context);

  actions.push({
    action: 'create-block',
    uid: tableContainerPlaceholder,
    string: '{{[[table]]}}',
    location: {
      'parent-uid': parentUid,
      order: params.order ?? 'last'
    }
  });

  // Create columns (headers)
  const columnPlaceholders: string[] = [];
  for (let i = 0; i < params.headers.length; i++) {
    const colPlaceholder = registerPlaceholder(`_col_${i}_${Date.now()}`, context);
    columnPlaceholders.push(colPlaceholder);

    actions.push({
      action: 'create-block',
      uid: colPlaceholder,
      string: params.headers[i] || ' ',
      location: {
        'parent-uid': tableContainerPlaceholder,
        order: i
      }
    });
  }

  // Create rows under each column
  for (let rowIdx = 0; rowIdx < params.rows.length; rowIdx++) {
    const row = params.rows[rowIdx];

    // First column gets the row label
    actions.push({
      action: 'create-block',
      string: row.label || ' ',
      location: {
        'parent-uid': columnPlaceholders[0],
        order: rowIdx
      }
    });

    // Remaining columns get the cells
    for (let cellIdx = 0; cellIdx < row.cells.length; cellIdx++) {
      actions.push({
        action: 'create-block',
        string: row.cells[cellIdx] || ' ',
        location: {
          'parent-uid': columnPlaceholders[cellIdx + 1],
          order: rowIdx
        }
      });
    }
  }

  return actions;
}

/**
 * Check an outline's `items` and bring each one to `{text, level, ...}`.
 *
 * A plain string is a level-1 block, which is what the help has always shown,
 * and a missing `level` is 1. Anything else is refused by name: a level that
 * is not a whole number of 1 or more used to reach `levelStack.length = level`
 * and surface as a bare "Invalid array length" (issue #34).
 *
 * Throws with the item's position, e.g. `items[2].level must be ...`.
 */
export function normalizeOutlineItems(items: unknown): OutlineItem[] {
  if (!Array.isArray(items)) {
    throw new Error(`'items' must be an array of strings or {text, level?} objects`);
  }

  return items.map((item, i) => {
    if (typeof item === 'string') {
      return { text: item, level: 1 };
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`items[${i}] must be a string or a {text, level?} object (got ${JSON.stringify(item)})`);
    }

    const { text, level: given } = item as Record<string, unknown>;
    if (typeof text !== 'string') {
      throw new Error(`items[${i}].text must be a string (got ${JSON.stringify(text)})`);
    }
    // "2" worked before by coercion, so it still does.
    const level = given == null ? 1
      : typeof given === 'string' && given.trim() !== '' ? Number(given)
      : given;
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1) {
      throw new Error(`items[${i}].level must be a whole number, 1 or more (got ${JSON.stringify(given)})`);
    }

    return { ...(item as OutlineItem), text, level };
  });
}

function translateOutline(cmd: OutlineCommand, context: ResolutionContext): BatchAction[] {
  const { params } = cmd;
  const parentUid = getParentUid(params, context);
  const actions: BatchAction[] = [];

  // Reset level stack with outline parent
  context.currentParent = parentUid;
  context.levelStack = [];

  for (const item of normalizeOutlineItems(params.items)) {
    let itemParentUid: string;

    if (item.level === 1) {
      itemParentUid = parentUid;
    } else {
      const levelParent = getParentFromLevel(item.level, context);
      if (!levelParent) {
        throw new Error(`Invalid outline hierarchy: level ${item.level} has no parent`);
      }
      itemParentUid = levelParent;
    }

    const action: BatchAction = {
      action: 'create-block',
      string: item.text,
      location: {
        'parent-uid': itemParentUid,
        order: 'last'
      }
    };

    // Register placeholder
    const placeholderName = item.as || `_outline_${actions.length}_${Date.now()}`;
    action.uid = registerPlaceholder(placeholderName, context);

    if (item.heading) {
      action.heading = item.heading;
    }

    // Update level stack
    updateLevelStack(item.level, action.uid, context);

    actions.push(action);
  }

  return actions;
}

function translateRemember(cmd: RememberCommand, context: ResolutionContext): BatchAction[] {
  const { params } = cmd;

  // Build memory text with categories (strip any pre-existing # or [[ ]] wrappers)
  let memoryText = params.text;
  if (params.categories && params.categories.length > 0) {
    const tags = params.categories.map(raw => {
      const cat = sanitizeTagName(raw);
      return `#[[${cat}]]`;
    }).join(' ');
    memoryText = `${params.text} ${tags}`;
  }

  // Add ROAM_MEMORIES_TAG if configured (we'll handle this in the CLI command)
  // For now, just create the block

  let parentUid: string;

  // If heading is specified, we'd need to look it up or create it
  // For simplicity, require parent UID when heading is used
  // TODO: Add heading resolution support
  if (params.heading && !params.parent) {
    throw new Error('remember with --heading requires --parent or heading resolution not yet implemented');
  }

  parentUid = getParentUid(params, context);

  const action: BatchAction = {
    action: 'create-block',
    string: memoryText,
    location: {
      'parent-uid': parentUid,
      order: params.order ?? 'last'
    }
  };

  if (params.as) {
    action.uid = registerPlaceholder(params.as, context);
  }

  return [action];
}

function translatePage(cmd: PageCommand, context: ResolutionContext): BatchAction[] {
  // Note: Page creation uses create-page API, not batch actions
  // We'll handle this specially in the batch command
  // For now, throw an error to indicate this needs special handling
  throw new Error('page command requires special handling outside batch actions');
}

function translateCodeblock(cmd: CodeblockCommand, context: ResolutionContext): BatchAction[] {
  const { params } = cmd;
  const parentUid = getParentUid(params, context);

  // Format code with triple backticks
  const codeContent = '```' + params.language + '\n' + params.code + '\n```';

  const action: BatchAction = {
    action: 'create-block',
    string: codeContent,
    location: {
      'parent-uid': parentUid,
      order: params.order ?? 'last'
    }
  };

  if (params.as) {
    action.uid = registerPlaceholder(params.as, context);
  }

  return [action];
}

/**
 * Point actions at pages created by `page` commands.
 *
 * A `page` command's `as` name stands for a page UID, and that UID exists only
 * once the page does, which is after translation. Until then a parent of
 * `{{name}}` is carried as `{{uid:name}}`, the form block placeholders use;
 * left like that, the batch takes it for a block nobody defined and refuses
 * the whole run. Called with the UIDs once the pages exist.
 */
export function bindPagePlaceholders(
  actions: BatchAction[],
  pageUidsByName: Map<string, string>
): BatchAction[] {
  const uidByPlaceholder = new Map(
    Array.from(pageUidsByName, ([name, uid]) => [generatePlaceholder(name), uid] as const)
  );

  return actions.map(action => {
    const parent = action.location?.['parent-uid'];
    const pageUid = parent === undefined ? undefined : uidByPlaceholder.get(parent);
    if (!action.location || pageUid === undefined) return action;
    return { ...action, location: { ...action.location, 'parent-uid': pageUid } };
  });
}

/**
 * Translate all commands to batch actions
 */
export function translateAllCommands(
  commands: BatchCommand[],
  context: ResolutionContext
): { actions: BatchAction[]; pageCommands: PageCommand[] } {
  const actions: BatchAction[] = [];
  const pageCommands: PageCommand[] = [];

  for (const cmd of commands) {
    if (cmd.command === 'page') {
      // Collect page commands for special handling
      pageCommands.push(cmd);
    } else {
      const cmdActions = translateCommand(cmd, context);
      actions.push(...cmdActions);
    }
  }

  return { actions, pageCommands };
}
