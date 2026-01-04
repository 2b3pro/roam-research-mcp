/**
 * Batch CLI command types
 */

// Base params shared by commands that create blocks
export interface BlockParamsBase {
  parent?: string;         // Parent UID or {{placeholder}}
  page?: string;           // Page title (triggers lookup)
  pageUid?: string;        // Direct page UID
  as?: string;             // Placeholder name for referencing
  order?: 'first' | 'last' | number;
}

// Create command
export interface CreateCommand {
  command: 'create';
  params: BlockParamsBase & {
    text: string;
    level?: number;        // For outline-style hierarchy
    heading?: 1 | 2 | 3;
    'children-view-type'?: 'bullet' | 'document' | 'numbered';
  };
}

// Update command
export interface UpdateCommand {
  command: 'update';
  params: {
    uid: string;
    text: string;
    heading?: 1 | 2 | 3;
    open?: boolean;
    'text-align'?: 'left' | 'center' | 'right' | 'justify';
    'children-view-type'?: 'bullet' | 'document' | 'numbered';
  };
}

// Delete command
export interface DeleteCommand {
  command: 'delete';
  params: {
    uid: string;
  };
}

// Move command
export interface MoveCommand {
  command: 'move';
  params: {
    uid: string;
    parent: string;
    order?: 'first' | 'last' | number;
  };
}

// Todo command
export interface TodoCommand {
  command: 'todo';
  params: BlockParamsBase & {
    text: string;
  };
}

// Table command
export interface TableCommand {
  command: 'table';
  params: BlockParamsBase & {
    headers: string[];
    rows: Array<{
      label: string;
      cells: string[];
    }>;
  };
}

// Outline command
export interface OutlineCommand {
  command: 'outline';
  params: BlockParamsBase & {
    items: Array<{
      text: string;
      level: number;
      heading?: 1 | 2 | 3;
      as?: string;
    }>;
  };
}

// Remember command
export interface RememberCommand {
  command: 'remember';
  params: BlockParamsBase & {
    text: string;
    categories?: string[];
    heading?: string;       // Heading text to nest under
  };
}

// Page command
export interface PageCommand {
  command: 'page';
  params: {
    title: string;
    as?: string;
    content?: Array<{
      text: string;
      level: number;
      heading?: 1 | 2 | 3;
    }>;
  };
}

// Codeblock command
export interface CodeblockCommand {
  command: 'codeblock';
  params: BlockParamsBase & {
    language: string;
    code: string;
  };
}

// Union of all commands
export type BatchCommand =
  | CreateCommand
  | UpdateCommand
  | DeleteCommand
  | MoveCommand
  | TodoCommand
  | TableCommand
  | OutlineCommand
  | RememberCommand
  | PageCommand
  | CodeblockCommand;

// Batch action (Roam API format)
export interface BatchAction {
  action: 'create-block' | 'update-block' | 'delete-block' | 'move-block';
  uid?: string;
  string?: string;
  location?: {
    'parent-uid': string;
    order: 'first' | 'last' | number;
  };
  open?: boolean;
  heading?: 1 | 2 | 3;
  'text-align'?: 'left' | 'center' | 'right' | 'justify';
  'children-view-type'?: 'bullet' | 'document' | 'numbered';
}

// Resolution context - tracks resolved UIDs and level hierarchy
export interface ResolutionContext {
  // Map of page titles to UIDs
  pageUids: Map<string, string>;
  // Map of placeholder names to generated UIDs
  placeholders: Map<string, string>;
  // Stack for level-based hierarchy: levelStack[level] = uid of last block at that level
  levelStack: string[];
  // Current parent UID for level-based nesting
  currentParent: string | null;
  // Daily page UID (resolved once, cached)
  dailyPageUid: string | null;
}

// Batch result
export interface BatchResult {
  success: boolean;
  actions_executed?: number;
  uid_map?: Record<string, string>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
