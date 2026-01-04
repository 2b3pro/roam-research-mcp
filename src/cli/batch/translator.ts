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
  RememberCommand,
  PageCommand,
  CodeblockCommand
} from './types.js';
import {
  resolveParentRef,
  generatePlaceholder,
  getDailyPageTitle
} from './resolver.js';

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
      return translateMove(command);
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
    return resolveParentRef(params.parent, context) || params.parent;
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

function translateMove(cmd: MoveCommand): BatchAction[] {
  const { params } = cmd;

  return [{
    action: 'move-block',
    uid: params.uid,
    location: {
      'parent-uid': params.parent,
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

function translateOutline(cmd: OutlineCommand, context: ResolutionContext): BatchAction[] {
  const { params } = cmd;
  const parentUid = getParentUid(params, context);
  const actions: BatchAction[] = [];

  // Reset level stack with outline parent
  context.currentParent = parentUid;
  context.levelStack = [];

  for (const item of params.items) {
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

  // Build memory text with categories
  let memoryText = params.text;
  if (params.categories && params.categories.length > 0) {
    const tags = params.categories.map(cat => `#[[${cat}]]`).join(' ');
    memoryText = `${params.text} ${tags}`;
  }

  // Add MEMORIES_TAG if configured (we'll handle this in the CLI command)
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
