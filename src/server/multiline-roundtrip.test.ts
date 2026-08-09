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

    // Eleven blocks in the fixture, so eleven lines. Two fixture blocks carry
    // an embedded newline, so a spill shows up as thirteen.
    expect(lines).toHaveLength(11);
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
    expect(byText.get('Line one⏎Line two')).toBe(2);
    expect(byText.get('grandchild under the multi-line block')).toBe(3);
    expect(byText.get('sibling after the multi-line block')).toBe(2);
    expect(byText.get('after the callout')).toBe(2);
    expect(byText.get('Timeline')).toBe(1);
    expect(byText.get('Q1 kickoff')).toBe(2);
  });

  it('round-trips a callout without splitting its body out', async () => {
    const body = bodyOf(await readMarkdown());
    expect(body).toContain('[[>]] [[!TIP]] Heads up⏎Callout body');
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

describe('Revision 2 acceptance criteria', () => {
  it('round-trips a page containing LaTeX, a Windows path and a stray fence', async () => {
    // Every shape that Revision 1 destroyed, on one page, through the real
    // tools. Zero actions is the only acceptable answer.
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

    expect(
      result.actions.map((a: { action: string }) => a.action),
      `unexpected actions: ${JSON.stringify(result.actions, null, 2)}`
    ).toEqual([]);
  });

  it('degrades to literal text, never deletion, when the marker is stripped', async () => {
    // The failure that will actually happen: an agent rebuilds the markdown
    // and drops the marker. It must not delete or reparent anything.
    const markdown = await readMarkdown();
    const body = bodyOf(markdown)
      .split('\n')
      .filter((l) => l.trim() !== ESCAPED_NEWLINES_MARKER)
      .join('\n');

    const result = JSON.parse(
      McpHarness.text(
        await harness.call('roam_update_page_markdown', {
          title: 'Nested Page',
          markdown: body,
          dry_run: true,
        })
      )
    );

    const deletes = result.actions.filter((a: { action: string }) => a.action === 'delete-block');
    const moves = result.actions.filter((a: { action: string }) => a.action === 'move-block');
    expect(deletes, 'a dropped marker must never delete a block').toEqual([]);
    expect(moves, 'a dropped marker must never reparent a block').toEqual([]);
  });
});

describe('Revision 3 acceptance criteria', () => {
  const readVerbatim = async () =>
    McpHarness.text(
      await harness.call('roam_fetch_page_by_title', {
        title: 'Nested Page',
        format: 'markdown',
      })
    );

  const dryRun = async (markdown: string) =>
    JSON.parse(
      McpHarness.text(
        await harness.call('roam_update_page_markdown', {
          title: 'Nested Page',
          markdown,
          dry_run: true,
        })
      )
    );

  it('C3: renderer output submitted VERBATIM, header included, is a no-op', async () => {
    // The exact path `roam save --update` takes, and the exact case the old
    // bodyOf() helper hid: the marker sits on line 2, after `# Title`.
    const result = await dryRun(await readVerbatim());
    expect(
      result.actions.map((a: { action: string }) => a.action),
      `unexpected actions: ${JSON.stringify(result.actions, null, 2)}`
    ).toEqual([]);
  });

  it('C4: a block appended inside a marked payload lands byte-identical', async () => {
    // Read-edit-append is the tool's primary workflow. The appended LaTeX and
    // path must survive untouched WHILE the page's own multi-line blocks are
    // still being decoded — both halves in one call.
    const appended = (await readVerbatim()) + '\n- $$\\nabla f$$ and C:\\newdir appended\n';
    const result = await dryRun(appended);

    const creates = result.actions.filter((a: { action: string }) => a.action === 'create-block');
    expect(creates).toHaveLength(1);
    expect(creates[0].block.string).toBe('$$\\nabla f$$ and C:\\newdir appended');
    expect(creates[0].block.string).not.toContain('\n');
    // And nothing else moved: the marked page's existing blocks still decode.
    expect(result.actions.filter((a: { action: string }) => a.action !== 'create-block')).toEqual([]);
  });

  it('degrades to literal sentinel text, never deletion, when the marker is dropped', async () => {
    const noMarker = (await readVerbatim())
      .split('\n')
      .filter((l) => l.trim() !== '<!-- roam:escaped-newlines -->')
      .join('\n');
    const result = await dryRun(noMarker);

    expect(result.actions.filter((a: { action: string }) => a.action === 'delete-block')).toEqual([]);
    expect(result.actions.filter((a: { action: string }) => a.action === 'move-block')).toEqual([]);
  });

  it('never strips a fresh, hand-authored H1 that happens to echo the page title', async () => {
    // No marker anywhere and no `⏎` sentinel in the body -- nothing about
    // this payload came from our renderer. A page whose real first block is
    // a genuine H1 reading "Nested Page" is plausible (imported docs, an
    // author echoing the page title), and it must not be silently deleted or
    // corrupted-via-reparenting just because the text happens to match the
    // title. The safe failure here is a harmless, visible stray block.
    //
    // This payload is intentionally a PARTIAL update (only "Project Alpha",
    // none of its descendants): `roam_update_page_markdown` REPLACES the
    // page, so content the markdown does not account for is deleted -- that
    // is documented, expected behaviour for ANY partial submission, entirely
    // independent of this gate (a full, faithful, unmarked reproduction of
    // this page is not constructible at all: its multi-line blocks cannot be
    // expressed on one physical line without the marker/sentinel this test
    // deliberately withholds). Asserting "zero delete-block actions" here
    // would therefore pin an artifact of an incomplete payload, not the
    // property this test exists to prove. What it does prove: the header
    // survives as its own honest create-block (the gate did not strip it),
    // and the real "Project Alpha" anchor it might have been mistaken for is
    // never itself deleted or overwritten to make room for it.
    const result = await dryRun('# Nested Page\n- Project Alpha\n');

    const creates = result.actions.filter((a: { action: string }) => a.action === 'create-block');
    expect(
      creates.map((a: { block: { string: string } }) => a.block.string),
      `expected the header line to survive as a stray block: ${JSON.stringify(result.actions, null, 2)}`
    ).toContain('Nested Page');

    const deletes = result.actions.filter((a: { action: string }) => a.action === 'delete-block');
    expect(
      deletes.map((a: { block: { uid: string } }) => a.block.uid),
      `the header must never consume or delete the real "Project Alpha" anchor block: ${JSON.stringify(result.actions, null, 2)}`
    ).not.toContain('nst000001');
  });
});
