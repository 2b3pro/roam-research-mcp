import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpHarness } from './testing/mcp-harness.js';
import { ESCAPED_NEWLINES_MARKER } from '../shared/block-escaping.js';

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

/**
 * Strip only the `# Title` line the markdown renderer prepends.
 *
 * Deliberately NOT a fixed 2-line strip: when the page needed escaping, the
 * renderer inserts `ESCAPED_NEWLINES_MARKER` as the line right after the
 * title, and that marker has to survive into whatever gets handed back to
 * `roam_update_page_markdown` -- it is the only signal that tells the write
 * path decoding is safe. Stripping a second fixed line would silently
 * discard it, exactly like a caller who "just removes the title" for
 * submission.
 */
const bodyOf = (markdown: string) => markdown.split('\n').slice(1).join('\n');

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
    // Excludes the escaped-newlines marker line: it is provenance metadata
    // for the write path, not a block, and this test counts blocks.
    const lines = bodyOf(await readMarkdown())
      .split('\n')
      .filter((l) => l.trim() && l.trim() !== ESCAPED_NEWLINES_MARKER);

    // Nine blocks in the fixture, so nine lines. Two fixture blocks carry an
    // embedded newline, so a spill shows up as eleven.
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

    // What this establishes: the renderer's own indentation for each block is
    // internally consistent, and the multi-line block's newline is carried as
    // an escaped `\n` in-line rather than spilling to a bare physical line.
    // It does NOT, on its own, prove Timeline keeps its real parent across a
    // round trip — pre-fix, the renderer still prints Timeline at the right
    // depth (only the spilled line's *own* indentation is wrong), and the
    // actual reparenting only appears once this markdown is re-parsed for a
    // diff. See "does not reparent Timeline" below for that proof.
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

  it('does not reparent Timeline out from under Project Alpha', async () => {
    // The direct proof the other assertions in this file cannot give: read
    // the dry-run diff's own actions rather than inferring structure from
    // rendered indentation. `nst000008` is Timeline's block uid (see the
    // page00002 fixture in tests/fake-roam-backend.mjs). Pre-fix, the actual
    // dry-run output contained:
    //
    //   { "action": "move-block",
    //     "block": { "uid": "nst000008" },
    //     "location": { "parent-uid": "nst000007", "order": 0 } }
    //
    // i.e. Timeline reparented under `nst000007` ("after the callout"), a
    // block inside Research's own subtree, instead of staying under
    // `nst000001` (Project Alpha). A no-op round trip must propose no
    // move-block for Timeline at all.
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

    const timelineMoves = result.actions.filter(
      (a: { action: string; block?: { uid: string } }) =>
        a.action === 'move-block' && a.block?.uid === 'nst000008'
    );
    expect(
      timelineMoves,
      `Timeline was reparented: ${JSON.stringify(timelineMoves, null, 2)}`
    ).toEqual([]);
  });
});

describe('the decode is gated on the marker', () => {
  it('does not decode a payload that lacks the marker', async () => {
    // The safety property. Hand-authored LaTeX must survive a page rewrite.
    const result = JSON.parse(
      McpHarness.text(
        await harness.call('roam_update_page_markdown', {
          title: 'Nested Page',
          markdown: '- $$\\nabla f$$\n',
          dry_run: true,
        })
      )
    );

    const created = result.actions.filter((a: { action: string }) => a.action === 'create-block');
    expect(created.length).toBeGreaterThan(0);
    for (const a of created) {
      expect(a.block.string).not.toContain('\n');
    }
    expect(JSON.stringify(result.actions)).toContain('nabla');
  });
});
