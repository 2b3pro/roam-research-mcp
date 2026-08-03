import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpHarness } from './testing/mcp-harness.js';
import { WRITE_OPERATIONS } from '../config/graph-registry.js';

/**
 * What a client actually gets back from a `tools/call`.
 *
 * Every other suite in this repo tests a unit. That is how two features shipped
 * broken on the same day: `pruneHiddenBlocks` had fifteen passing tests but no
 * tool invoked it, and the annotations had a passing schema test but nothing
 * proved the server declared them. Both defects are invisible to a unit test
 * and both are caught below.
 *
 * The Roam wire is fixtured by `tests/fake-roam-backend.mjs`; everything above
 * it — transport, MCP routing, graph resolution, operation classes, SDK — is
 * the real thing.
 */

const harness = new McpHarness({
  preload: './tests/fake-roam-backend.mjs',
  env: {
    ROAM_API_TOKEN: 'fake-token-for-tests',
    ROAM_GRAPH_NAME: 'fake-graph',
  },
});

beforeAll(() => harness.start(), 20000);
afterAll(() => harness.stop());

describe('tools/list contract', () => {
  it('annotates every tool it declares', async () => {
    const tools = await harness.list();
    expect(tools.length).toBeGreaterThan(20);

    const unannotated = tools.filter((t) => !t.annotations).map((t) => t.name);
    expect(unannotated).toEqual([]);

    for (const tool of tools) {
      expect(Object.keys(tool.annotations!).sort()).toEqual([
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
        'readOnlyHint',
      ]);
    }
  });

  it('marks exactly the write operations as not read-only', async () => {
    const tools = await harness.list();
    const declaredWriters = tools
      .filter((t) => t.annotations?.readOnlyHint === false)
      .map((t) => t.name)
      .sort();

    // The invariant a client depends on: `readOnlyHint: true` must mean the
    // tool cannot write. A schema test can only compare one file against
    // another; this compares what the server SAYS against what it ENFORCES,
    // since WRITE_OPERATIONS is the same list the write gate consults.
    expect(declaredWriters).toEqual([...WRITE_OPERATIONS].sort());
  });

  it('points every tool at the guidelines tool', async () => {
    const tools = await harness.list();
    const silent = tools
      .filter((t) => t.name !== 'roam_get_guidelines')
      .filter((t) => !t.description.includes('roam_get_guidelines'))
      .map((t) => t.name);
    expect(silent).toEqual([]);
  });
});

describe('output schemas', () => {
  it('declares one for exactly the write tools', async () => {
    const tools = await harness.list();
    const withSchema = tools
      .filter((t) => (t as { outputSchema?: unknown }).outputSchema)
      .map((t) => t.name)
      .sort();

    // Reads are deliberately schema-less: they already serialise their whole
    // result into the text channel, so a schema doubles the payload, and their
    // shapes still move.
    expect(withSchema).toEqual([...WRITE_OPERATIONS].sort());
  });

  it('keeps every schema open to additive growth', async () => {
    const tools = await harness.list();
    for (const tool of tools) {
      const schema = (tool as { outputSchema?: Record<string, any> }).outputSchema;
      if (!schema) continue;

      expect(schema.type, tool.name).toBe('object');
      // A closed schema would reject any field added later — the opposite of
      // the additive-only rule these are supposed to make safe.
      expect(schema.additionalProperties, tool.name).toBe(true);
      // `success` is the one field all ten genuinely return, so it is the only
      // thing a client can rely on across the whole write surface.
      expect(schema.required, tool.name).toContain('success');
      expect(schema.properties.success, tool.name).toEqual({ type: 'boolean' });
    }
  });

  it('returns structuredContent from a write tool, matching the text channel', async () => {
    // The wire invariant, checked where it actually has to hold. Nothing in the
    // SDK enforces it for us — we use the low-level Server.
    const result = await harness.call('roam_add_todo', { todos: ['boundary test todo'] });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent).toEqual(JSON.parse(McpHarness.text(result)));
    expect((result.structuredContent as { success: boolean }).success).toBe(true);
  });

  it('omits structuredContent from a tool that declares no schema', async () => {
    const result = await harness.call('roam_get_guidelines');
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('roam_fetch_page_by_title withholds hidden content', () => {
  it('omits a #.rm-hide block and its entire subtree', async () => {
    const text = McpHarness.text(
      await harness.call('roam_fetch_page_by_title', { title: 'Test Page', format: 'markdown' })
    );

    expect(text).toContain('First visible block');
    expect(text).toContain('Second visible block');
    expect(text).toContain('Visible child of a visible block');

    expect(text).not.toContain('Secret plans');
    expect(text).not.toContain('Nested under the hidden block');
    expect(text).not.toContain('Two levels under the hidden block');
  });

  it('omits a [[.rm-private]] block and its subtree', async () => {
    const text = McpHarness.text(
      await harness.call('roam_fetch_page_by_title', { title: 'Test Page', format: 'markdown' })
    );
    expect(text).not.toContain('Private note');
    expect(text).not.toContain('Nested under the private block');
  });

  it('keeps blocks whose tags merely start the same way', async () => {
    // `#.rm-hidden` and `#.rm-highlight` are not hide tags. Over-hiding is the
    // safe direction for the regex, but not so safe that it may eat these.
    const text = McpHarness.text(
      await harness.call('roam_fetch_page_by_title', { title: 'Test Page', format: 'markdown' })
    );
    expect(text).toContain('Near miss, must stay');
    expect(text).toContain('Other near miss, must stay');
  });

  it.each(['raw', 'structure'] as const)('filters the %s format too', async (format) => {
    // Each format renders from its own branch, so passing on markdown alone
    // proves nothing about the other two.
    const text = McpHarness.text(
      await harness.call('roam_fetch_page_by_title', { title: 'Test Page', format })
    );
    expect(text).toContain('First visible block');
    expect(text).not.toContain('Secret plans');
    expect(text).not.toContain('Nested under the hidden block');
    expect(text).not.toContain('Private note');
  });
});

describe('roam_get_guidelines', () => {
  it('reads the conventional page with no configuration at all', async () => {
    // Zero-config is the whole design: creating the page IS the opt-in. This
    // server was started with nothing but a token and a graph name.
    const result = JSON.parse(McpHarness.text(await harness.call('roam_get_guidelines')));
    expect(result.exists).toBe(true);
    expect(result.page).toBe('roam/agent guidelines');
    expect(result.guidelines).toContain('Tag every book page');
  });

  it('tells the agent not to call it again this session', async () => {
    const result = JSON.parse(McpHarness.text(await harness.call('roam_get_guidelines')));
    expect(result.nextSteps).toMatch(/do not call this tool again/i);
  });
});
