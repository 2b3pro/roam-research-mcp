import { Graph } from '@roam-research/roam-api-sdk';
import { BatchOperations, type BatchResult } from './batch.js';

export interface TableRow {
  label: string;      // First column (row label)
  cells: string[];    // Remaining cells
}

export interface TableInput {
  parent_uid: string;
  order?: number | 'first' | 'last';
  headers: string[];  // Column headers
  rows: TableRow[];
}

export interface TableValidationError {
  field: string;
  message: string;
}

export interface TableValidationResult {
  valid: boolean;
  errors: TableValidationError[];
}

export interface TableResult extends BatchResult {
  table_uid?: string;
}

/**
 * Validates table input before building actions.
 */
export function validateTableInput(input: TableInput): TableValidationResult {
  const errors: TableValidationError[] = [];

  if (!input.parent_uid) {
    errors.push({ field: 'parent_uid', message: 'parent_uid is required' });
  }

  if (!input.headers || !Array.isArray(input.headers)) {
    errors.push({ field: 'headers', message: 'headers must be an array' });
  } else if (input.headers.length === 0) {
    errors.push({ field: 'headers', message: 'At least one header is required' });
  }

  if (!input.rows || !Array.isArray(input.rows)) {
    errors.push({ field: 'rows', message: 'rows must be an array' });
  } else {
    const expectedCells = (input.headers?.length || 1) - 1;
    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i];
      if (!row.label && row.label !== '') {
        errors.push({
          field: `rows[${i}].label`,
          message: 'Row label is required (use empty string for blank)'
        });
      }
      if (!Array.isArray(row.cells)) {
        errors.push({
          field: `rows[${i}].cells`,
          message: 'Row cells must be an array'
        });
      } else if (row.cells.length !== expectedCells) {
        errors.push({
          field: `rows[${i}].cells`,
          message: `Expected ${expectedCells} cells, got ${row.cells.length}`
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * The placeholder names a table's blocks are created under.
 *
 * One batch resolves every `{{uid:name}}` it holds to one UID per name, so two
 * tables built with the same names would be created on top of each other. A
 * batch that can hold more than one table gives each its own names.
 */
export interface TablePlaceholderNames {
  /** Name of the table block itself; the key it is reported under in `uid_map`. */
  table: string;
  /** Prefix for the names of the header and cell blocks. */
  cellPrefix: string;
}

const SINGLE_TABLE_NAMES: TablePlaceholderNames = { table: 'table', cellPrefix: '' };

/**
 * Builds batch actions for creating a Roam table structure.
 *
 * Roam tables have a specific nested structure:
 * - The table container block contains {{[[table]]}}
 * - Header row is nested deeply (each column nested under the previous)
 * - Data rows follow the same nesting pattern
 *
 * This is the one place a table's layout is decided: `roam_create_table`,
 * tables in `roam_create_page` content and `roam batch` all build through it.
 */
export function buildTableActions(
  input: TableInput,
  names: TablePlaceholderNames = SINGLE_TABLE_NAMES
): any[] {
  const actions: any[] = [];
  const tableUid = `{{uid:${names.table}}}`;
  const cellUid = (name: string) => `{{uid:${names.cellPrefix}${name}}}`;

  // Create table container
  actions.push({
    action: 'create-block',
    uid: tableUid,
    string: '{{[[table]]}}',
    location: { 'parent-uid': input.parent_uid, order: input.order ?? 'last' }
  });

  // Create header row with nested structure
  // In Roam tables, each column is nested under the previous column
  let headerParent = tableUid;
  for (let i = 0; i < input.headers.length; i++) {
    const uid = cellUid(`header_${i}`);
    const headerText = input.headers[i] || ' ';  // Convert empty to space
    actions.push({
      action: 'create-block',
      uid,
      string: headerText,
      location: { 'parent-uid': headerParent, order: 0 }
    });
    headerParent = uid;
  }

  // Create data rows
  // Each row starts as a child of the table, with cells nested under each other
  for (let rowIdx = 0; rowIdx < input.rows.length; rowIdx++) {
    const row = input.rows[rowIdx];

    // Row label (first column) - child of table at position rowIdx + 1 (after header)
    const labelUid = cellUid(`row_${rowIdx}_label`);
    const labelText = row.label || ' ';  // Convert empty to space
    actions.push({
      action: 'create-block',
      uid: labelUid,
      string: labelText,
      location: { 'parent-uid': tableUid, order: rowIdx + 1 }
    });

    // Row cells - each cell is nested under the previous
    let cellParent = labelUid;
    for (let cellIdx = 0; cellIdx < row.cells.length; cellIdx++) {
      const uid = cellUid(`row_${rowIdx}_cell_${cellIdx}`);
      const cellText = row.cells[cellIdx] || ' ';  // Convert empty to space
      actions.push({
        action: 'create-block',
        uid,
        string: cellText,
        location: { 'parent-uid': cellParent, order: 0 }
      });
      cellParent = uid;
    }
  }

  return actions;
}

export class TableOperations {
  private batchOps: BatchOperations;

  constructor(graph: Graph) {
    this.batchOps = new BatchOperations(graph);
  }

  /**
   * Creates a table in Roam with the specified headers and rows.
   *
   * @param input Table configuration including parent_uid, headers, and rows
   * @returns Result including success status and table block UID
   */
  async createTable(input: TableInput): Promise<TableResult> {
    // Validate input
    const validation = validateTableInput(input);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors.map(e => `[${e.field}] ${e.message}`).join('; ')
        },
        validation_passed: false,
        actions_attempted: 0
      };
    }

    // Build table actions
    const actions = buildTableActions(input);

    // Execute batch
    const result = await this.batchOps.processBatch(actions);

    // Add table_uid if successful
    if (result.success && result.uid_map) {
      return {
        ...result,
        table_uid: result.uid_map['table']
      };
    }

    return result;
  }
}
