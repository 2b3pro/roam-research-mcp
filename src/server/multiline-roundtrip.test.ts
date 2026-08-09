import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * The acceptance criterion for docs/multiline-block-roundtrip-spec.md:
 *
 *   Read a page as markdown, hand it straight back to
 *   roam_update_page_markdown unedited, and the diff must be empty AND every
 *   parent/child relationship unchanged.
 *
 * Both halves matter. Before the fix a soft line break spilled to column 0,
 * reset the indentation baseline, and reparented every following block —
 * `Timeline` ended up under `sibling after the multi-line block`. A test that
 * only counted actions would have passed on that flattened tree, which is how
 * the bug survived.
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

const readMarkdown = async () =>
  McpHarness.text(
    await harness.call('roam_fetch_page_by_title', {
      title: 'Nested Page',
      format: 'markdown',
    })
  );

/** Strip the `# Title` header the markdown renderer prepends. */
const bodyOf = (markdown: string) => markdown.split('\n').slice(2).join('\n');

describe('read → write-back is a no-op', () => {
  it('produces an empty diff', async () => {
    const markdown = await readMarkdown();

    const result = JSON.parse(
      McpHarness.text(
        await harness.call('roam_update_page_markdown', {
          title: 'Nested Page',
          markdown: bodyOf(markdown),
          dry_run: true,
        })
      )
    );

    const kinds = result.actions.map((a: { action: string }) => a.action);
    expect(kinds, `unexpected actions: ${JSON.stringify(result.actions, null, 2)}`).toEqual([]);
  });

  it('keeps every multi-line block on one physical line', async () => {
    const lines = bodyOf(await readMarkdown()).split('\n').filter((l) => l.trim());

    // Nine blocks in the fixture, so nine lines. A spill shows up as ten.
    expect(lines).toHaveLength(9);
    for (const line of lines) {
      expect(line, `line without a bullet: ${JSON.stringify(line)}`).toMatch(/^\s*-\s/);
    }
  });

  it('preserves the parent of every block, not merely the block count', async () => {
    const lines = bodyOf(await readMarkdown()).split('\n').filter((l) => l.trim());
    const depth = (line: string) => (line.match(/^\s*/)?.[0].length ?? 0) / 2;

    const byText = new Map(
      lines.map((l) => [l.trim().replace(/^-\s*/, ''), depth(l)] as const)
    );

    // The exact shape the bug destroyed: Timeline is a child of Project Alpha,
    // NOT of the sibling that precedes it.
    expect(byText.get('Project Alpha')).toBe(0);
    expect(byText.get('Research')).toBe(1);
    expect(byText.get('Line one\\nLine two')).toBe(2);
    expect(byText.get('grandchild under the multi-line block')).toBe(3);
    expect(byText.get('sibling after the multi-line block')).toBe(2);
    expect(byText.get('after the callout')).toBe(2);
    expect(byText.get('Timeline')).toBe(1);
    expect(byText.get('Q1 kickoff')).toBe(2);
  });

  it('round-trips a callout without splitting its body out', async () => {
    const body = bodyOf(await readMarkdown());
    expect(body).toContain('[[>]] [[!TIP]] Heads up\\nCallout body');
    expect(body).not.toMatch(/^Callout body/m);
  });
});
