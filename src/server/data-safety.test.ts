import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpHarness } from './testing/mcp-harness.js';
import { ROAM_SYNTAX } from '../tools/roam-syntax.js';

/**
 * The two channels through which the server warns a client about writes that
 * destroy content:
 *
 *   1. `roam_get_guidelines` carries `roamSyntax` — the rules a model needs
 *      before its first write, on a response it already asks for.
 *   2. `roam_fetch_page_by_title` with `format: "structure"` marks the entries
 *      whose `text` is a truncated preview, because the format's whole purpose
 *      invites feeding those entries straight back into an update.
 *
 * Both are only worth anything if they survive to the wire, which is why they
 * are tested here rather than against the operation classes. A constant that
 * exists and a field that reaches a client are different claims, and the
 * second one is the one that matters.
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

const guidelines = async () =>
  JSON.parse(McpHarness.text(await harness.call('roam_get_guidelines')));

describe('roam_get_guidelines carries the data-safety rules', () => {
  it('returns roamSyntax verbatim to a client', async () => {
    const result = await guidelines();
    // Not "contains something syntax-ish" — the exact constant. A partial or
    // reformatted blob is the failure mode worth catching, since the ordering
    // is load-bearing.
    expect(result.roamSyntax).toBe(ROAM_SYNTAX);
  });

  it('warns about each destructive path by name', async () => {
    const { roamSyntax } = await guidelines();

    // The three ways an agent destroys content with this server, plus the
    // incompleteness caution. If a rewrite of the blob drops one, that is a
    // regression regardless of how much better the prose reads.
    expect(roamSyntax).toContain('roam_update_page_markdown');
    expect(roamSyntax).toMatch(/truncated/i);
    expect(roamSyntax).toContain('((block-uid))');
    expect(roamSyntax).toMatch(/#\.rm-hide/);
  });

  it('states that conventions cannot override the safety rules', async () => {
    // The layering rule. Without it a graph whose guidelines page says "always
    // rewrite the whole page" reads as permission to do exactly that.
    const { roamSyntax } = await guidelines();
    expect(roamSyntax).toMatch(/regardless|hold regardless/i);
  });

  it('ends with the pre-write check', async () => {
    // Recency half of the damage-ranked ordering: whatever else gets added,
    // the checklist stays last.
    const { roamSyntax } = await guidelines();
    expect(roamSyntax.trimEnd().split('\n').pop()).toMatch(/^BEFORE EVERY WRITE:/);
  });

  // That the rules also survive the no-page / disabled / read-failed paths is
  // covered in `tools/operations/guidelines.test.ts`, which can drive those
  // branches directly. This file's job is proving the field reaches the wire.
});

describe('the structure format marks truncated previews', () => {
  const structure = async () =>
    JSON.parse(
      McpHarness.text(
        await harness.call('roam_fetch_page_by_title', {
          title: 'Test Page',
          format: 'structure',
        })
      )
    );

  it('flags a cut entry and reports the real length', async () => {
    const { blocks } = await structure();
    const long = blocks.find((b: { uid: string }) => b.uid === 'long00001');

    expect(long).toBeDefined();
    expect(long.truncated).toBe(true);
    expect(long.full_length).toBeGreaterThan(80);
    expect(long.text).toHaveLength(83); // 80 chars + the '...' marker
    // The tail is the content a write-back would destroy. It must not appear
    // here, or the test proves nothing about the hazard.
    expect(long.text).not.toContain('TAIL_MARKER');
  });

  it('leaves short entries unmarked', async () => {
    // A flag on everything is a flag on nothing.
    const { blocks } = await structure();
    const short = blocks.find((b: { uid: string }) => b.uid === 'vis000001');

    expect(short.text).toBe('First visible block');
    expect(short.truncated).toBeUndefined();
    expect(short.full_length).toBeUndefined();
  });

  it('warns once at the top, naming the tool that recovers the full text', async () => {
    const result = await structure();

    expect(result.truncated_count).toBe(1);
    expect(result.warning).toContain('roam_fetch_block');
    expect(result.warning).toMatch(/preview/i);
  });

  it('omits the warning entirely when nothing was cut', async () => {
    // Otherwise every response pays for it and models learn to skim past it.
    // The guidelines page fixture holds one short block.
    const result = JSON.parse(
      McpHarness.text(
        await harness.call('roam_fetch_page_by_title', {
          title: 'roam/agent guidelines',
          format: 'structure',
        })
      )
    );

    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks.every((b: { truncated?: boolean }) => !b.truncated)).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.truncated_count).toBeUndefined();
  });

  it('still withholds hidden blocks while marking truncation', async () => {
    // The two filters run in the same branch; neither may disable the other.
    const { blocks } = await structure();
    const uids = blocks.map((b: { uid: string }) => b.uid);

    expect(uids).toContain('long00001');
    expect(uids).not.toContain('hid000001');
    expect(uids).not.toContain('hidchild1');
    expect(uids).not.toContain('prv000001');
  });
});

describe('roam_update_page_markdown does not delete what it would not show', () => {
  /**
   * The asymmetry this covers: every read filters `#.rm-hide` / `#.rm-private`
   * subtrees, so replacement markdown cannot possibly include them — and the
   * diff used to compare that markdown against the UNFILTERED page and delete
   * them as unaccounted-for. The hide tag became a deletion mechanism, against
   * an API with no undo.
   *
   * `dry_run` so the assertion lands on the planned actions, which is where
   * the bug lived. The fixture's write path does not model block state, so
   * asserting on the graph afterwards would prove nothing anyway.
   */
  const plan = async (markdown: string) =>
    JSON.parse(
      McpHarness.text(
        await harness.call('roam_update_page_markdown', {
          title: 'Test Page',
          markdown,
          dry_run: true,
        })
      )
    );

  const deletedUids = (result: { actions: { action: string; block?: { uid: string } }[] }) =>
    result.actions.filter((a) => a.action === 'delete-block').map((a) => a.block?.uid);

  it('deletes no hidden block when the markdown omits every one of them', async () => {
    // The exact shape of the bug: an agent read the page, saw only the visible
    // blocks, and sent back a subset of those.
    const result = await plan('- First visible block\n');
    const deleted = deletedUids(result);

    for (const uid of ['hid000001', 'hidchild1', 'hidgrand1', 'prv000001', 'prvchild1']) {
      expect(deleted, `${uid} must survive a rewrite that could not mention it`).not.toContain(uid);
    }
  });

  it('still deletes visible blocks the markdown drops', async () => {
    // Without this the test above passes on a diff that deletes nothing at
    // all, which is the failure mode that makes a protection test worthless.
    const result = await plan('- First visible block\n');
    const deleted = deletedUids(result);

    expect(deleted).toContain('vis000002');
    expect(deleted).toContain('near00001');
    expect(deleted.length).toBeGreaterThan(0);
  });

  it('reports how many blocks it protected', async () => {
    // Two hidden subtrees in the fixture: #.rm-hide with two descendants, and
    // [[.rm-private]] with one. Five blocks, all counted.
    const result = await plan('- First visible block\n');
    expect(result.preserved_hidden).toBe(5);
    expect(result.summary).toMatch(/5 hidden blocks/);
  });

  it('says nothing about hidden blocks on a page that has none', async () => {
    const result = JSON.parse(
      McpHarness.text(
        await harness.call('roam_update_page_markdown', {
          title: 'roam/agent guidelines',
          markdown: '- Tag every book page with Type:: Book\n',
          dry_run: true,
        })
      )
    );

    expect(result.preserved_hidden).toBeUndefined();
    expect(result.summary).not.toMatch(/hidden/i);
  });
});

describe('parse-side tools accept soft line breaks', () => {
  it('roam_import_markdown makes one block from an escaped newline', async () => {
    // No `parent_string` here (the brief's original draft used one): looking
    // one up sends outline.ts's OutlineOperations through
    // `createAndVerifyBlock`'s real exponential-backoff retry loop, which
    // depends on a follow-up `q()` query the fixture cannot answer (see
    // `answer()` in fake-roam-backend.mjs — no branch matches that
    // find-clause shape). Against this fixture that path burns tens of
    // seconds before failing outright, blowing past McpHarness's fixed 15s
    // request timeout. Writing straight to the page root exercises the same
    // parseMarkdown call this test exists to prove, without that unrelated
    // and unsupported lookup.
    const result = JSON.parse(
      McpHarness.text(
        await harness.call('roam_import_markdown', {
          page_title: 'Test Page',
          content: '- alpha\\nbeta\n- gamma\n',
        })
      )
    );
    expect(result.success).toBe(true);
  });

  it('roam_create_outline survives a fenced code block without eating siblings', async () => {
    // The Task 3 fence guard reaching a second caller. Before it, the fence
    // opened a region that consumed the item after it.
    //
    // Content note: this is a single-line, self-closing fence with NO `\n`
    // anywhere — not real, not escaped. (The brief's original draft used
    // '```js\\nconst x = 1;\\n```', an escaped-newline fence.) That content
    // still exercises the exact same regression — createOutline's own
    // isCodeBlock check requires a REAL newline to skip the bullet prefix, so
    // an escaped one still arrives here as an ordinary bulleted line, and it
    // is the bullet prefix ("- ```js...") that shifts the fence markers off
    // column 0 and triggers the mid-line splice `fenceClosesOnSameLine`
    // guards in markdown-utils.ts. But an escaped-newline fence also gets
    // unescaped into real newlines by Task 4's decode step before it is
    // written, so the block's stored string no longer matches the raw
    // `item.text` roam_create_outline's own post-write verification queries
    // by (see `findBlockWithRetry` in outline.ts) — that verification would
    // fail to find it even with correct fence-guard behavior, for reasons
    // unrelated to this test's target. Dropping the escape avoids that
    // unrelated mismatch and lets `created_blocks` actually reflect reality.
    const result = JSON.parse(
      McpHarness.text(
        await harness.call('roam_create_outline', {
          page_title_uid: 'Test Page',
          outline: [
            { text: '```js console.log(1);```', level: 1 },
            { text: 'after the code block', level: 1 },
          ],
        })
      )
    );
    expect(result.success).toBe(true);
    expect(result.created_blocks?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe('markdown render escapes newlines for the round trip', () => {
  it('emits a multi-line block on a single line', async () => {
    const text = McpHarness.text(
      await harness.call('roam_fetch_page_by_title', {
        title: 'Test Page',
        format: 'markdown',
      })
    );

    // The fixture's multi-line block must not spill onto a second physical
    // line — that spill is what resets the indentation baseline.
    expect(text).toContain('Soft break one\\nSoft break two');
    expect(text).not.toMatch(/^Soft break two/m);
  });

  it('does not escape the guidelines page, which is read as prose', async () => {
    // Same renderer, different caller. A backslash in someone's conventions
    // must not come back doubled.
    const result = JSON.parse(McpHarness.text(await harness.call('roam_get_guidelines')));
    expect(result.guidelines).not.toContain('\\\\');
  });

  it('uses the same encoding in the full-page view', async () => {
    const text = McpHarness.text(
      await harness.call('roam_fetch_page_full_view', { title: 'Test Page' })
    );

    expect(text).toContain('Soft break one\\nSoft break two');
    expect(text).not.toMatch(/^Soft break two/m);
  });
});

describe('roam_create_page accepts soft line breaks', () => {
  it('writes a block containing a real newline', async () => {
    const result = JSON.parse(
      McpHarness.text(
        await harness.call('roam_create_page', {
          title: 'Soft Break Page',
          content: [{ text: 'first\\nsecond', level: 1 }],
        })
      )
    );
    expect(result.success).toBe(true);
  });
});
