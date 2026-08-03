import { describe, it, expect } from 'vitest';
import { toolSchemas } from './schemas.js';
import { WRITE_OPERATIONS, isWriteOperation } from '../config/graph-registry.js';

/**
 * Tool annotations are load-bearing: MCP clients gate tools by them, and per the
 * spec an omitted annotation defaults to destructive + open-world. Before these
 * existed, every read tool we shipped advertised itself as capable of
 * irreversible damage. This suite pins the classification so a future edit can't
 * silently drop or flip a hint.
 */

type Annotated = {
  name: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

const allTools = Object.values(toolSchemas) as unknown as Annotated[];

function annotationsFor(name: string) {
  const tool = allTools.find((t) => t.name === name);
  expect(tool, `tool ${name} should exist`).toBeDefined();
  return tool!.annotations;
}

describe('tool annotations', () => {
  it('every tool carries annotations — an untagged tool reads as destructive', () => {
    const untagged = allTools.filter((t) => !t.annotations).map((t) => t.name);
    expect(untagged, 'tools missing annotations').toEqual([]);
  });

  it('every tool declares all four hints explicitly', () => {
    for (const tool of allTools) {
      const a = tool.annotations!;
      expect(typeof a.readOnlyHint, `${tool.name}.readOnlyHint`).toBe('boolean');
      expect(typeof a.destructiveHint, `${tool.name}.destructiveHint`).toBe('boolean');
      expect(typeof a.idempotentHint, `${tool.name}.idempotentHint`).toBe('boolean');
      expect(typeof a.openWorldHint, `${tool.name}.openWorldHint`).toBe('boolean');
    }
  });

  it('reads are read-only and non-destructive', () => {
    for (const name of [
      'roam_fetch_page_by_title',
      'roam_fetch_block',
      'roam_fetch_page_full_view',
      'roam_get_subpages',
      'roam_search_by_text',
      'roam_search_for_tag',
      'roam_search_by_status',
      'roam_search_block_refs',
      'roam_search_hierarchy',
      'roam_search_by_date',
      'roam_find_pages_modified_today',
      'roam_datomic_query',
      'roam_recall',
      'roam_markdown_cheatsheet',
    ]) {
      const a = annotationsFor(name);
      expect(a?.readOnlyHint, name).toBe(true);
      expect(a?.destructiveHint, name).toBe(false);
      expect(a?.idempotentHint, name).toBe(true);
    }
  });

  it('appends are writes but not destructive', () => {
    for (const name of [
      'roam_add_todo',
      'roam_create_page',
      'roam_create_outline',
      'roam_import_markdown',
      'roam_remember',
      'roam_create_table',
    ]) {
      const a = annotationsFor(name);
      expect(a?.readOnlyHint, name).toBe(false);
      expect(a?.destructiveHint, name).toBe(false);
    }
  });

  it('edits and moves are destructive (overwrite/relocate) but idempotent', () => {
    // roam_update_page_markdown earns destructiveHint because its smart diff
    // emits delete operations, not just creates and updates.
    for (const name of ['roam_move_block', 'roam_update_page_markdown', 'roam_rename_page']) {
      const a = annotationsFor(name);
      expect(a?.readOnlyHint, name).toBe(false);
      expect(a?.destructiveHint, name).toBe(true);
      expect(a?.idempotentHint, name).toBe(true);
    }
  });

  it('batch actions are destructive and non-idempotent (delete-block is in its enum)', () => {
    const a = annotationsFor('roam_process_batch_actions');
    expect(a?.readOnlyHint).toBe(false);
    expect(a?.destructiveHint).toBe(true);
    expect(a?.idempotentHint).toBe(false);
  });

  it('no tool claims an open world — every tool acts only on the user\'s graph', () => {
    for (const tool of allTools) {
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }
  });

  it('a read-only tool never also claims to be destructive', () => {
    for (const tool of allTools) {
      const a = tool.annotations!;
      if (a.readOnlyHint) {
        expect(a.destructiveHint, `${tool.name} is readOnly but destructive`).toBe(false);
      }
    }
  });
});

describe('annotations agree with the write-protection list', () => {
  /**
   * WRITE_OPERATIONS drives write-key enforcement on protected graphs; the
   * annotations drive client-side gating. They describe the same property, so
   * they must not drift: a tool that mutates the graph has to appear in both.
   */
  it('readOnlyHint is false for exactly the tools in WRITE_OPERATIONS', () => {
    const annotatedWrites = allTools
      .filter((t) => t.annotations?.readOnlyHint === false)
      .map((t) => t.name)
      .sort();

    expect(annotatedWrites).toEqual([...WRITE_OPERATIONS].sort());
  });

  it('every write-annotated tool is recognised by isWriteOperation()', () => {
    for (const tool of allTools) {
      if (tool.annotations?.readOnlyHint === false) {
        expect(isWriteOperation(tool.name), `${tool.name} should be a write operation`).toBe(true);
      }
    }
  });
});
