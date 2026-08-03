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

describe('guidelines nudge', () => {
  /**
   * A tool nobody is told to call is inert. Roam's own server appends a note to
   * every tool description for exactly this reason, and found empirically that
   * it has to say "reads too" or agents rationalise reads as exempt.
   */
  const described = allTools as unknown as { name: string; description: string }[];
  const others = described.filter((t) => t.name !== 'roam_get_guidelines');

  it('every tool except the guidelines tool itself points at it', () => {
    const silent = others.filter((t) => !t.description.includes('roam_get_guidelines'));
    expect(silent.map((t) => t.name), 'tools with no guidelines nudge').toEqual([]);
  });

  it('the guidelines tool does not tell the agent to call itself', () => {
    const self = described.find((t) => t.name === 'roam_get_guidelines')!;
    expect(self.description).not.toMatch(/call roam_get_guidelines for this graph/);
  });

  it('says the rule applies to reads, which is the clause agents talk themselves out of', () => {
    const reads = others.filter((t) => {
      const tool = allTools.find((x) => x.name === t.name);
      return tool?.annotations?.readOnlyHint === true;
    });
    for (const t of reads) {
      expect(t.description, t.name).toMatch(/reads included/);
    }
  });

  it('content-authoring tools ask for the cheatsheet in the same breath, not a second stacked note', () => {
    const authoring = others.filter((t) => t.description.includes('Roam Markdown Cheatsheet'));
    // The 6 appends, the destructive batch, and the smart-diff edit.
    expect(authoring).toHaveLength(8);
    for (const t of authoring) {
      expect(t.description, t.name).toMatch(
        /call roam_get_guidelines for this graph once per session, and load the Roam Markdown Cheatsheet/
      );
      // The old standalone cheatsheet note must be gone — two competing
      // "read this first" blocks is how an agent ends up following neither.
      expect(t.description, t.name).not.toMatch(/ensure that you have loaded into context/);
    }
  });

  it('carries the once-per-session limiter so agents do not re-orient every call', () => {
    for (const t of others) {
      expect(t.description, t.name).toMatch(/once per session/);
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
