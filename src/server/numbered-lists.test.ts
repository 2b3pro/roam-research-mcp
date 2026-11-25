import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * Numbered lists through `roam_update_page_markdown`.
 *
 * In Roam a numbered list is a setting on the parent block, not text on the
 * items. The page diff knew nothing about it: it never read the setting and
 * never wrote it, so `1. First` in an update arrived as a plain bullet reading
 * "First", with its number gone.
 *
 * The rule now is set-only. A numbered item in the markdown makes its parent
 * numbered. Items written as bullets never take the setting away, because the
 * markdown read shows every list as bullets: a page read and written back
 * would otherwise lose every numbered list on it.
 *
 * Fixture (tests/fake-roam-backend.mjs): page "Numbered Fixture", with
 * "Numbered steps" (numbered) and "Plain list" (not).
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

interface Action {
  action: string;
  block: { uid: string; string?: string; 'children-view-type'?: string };
}

const plan = async (markdown: string): Promise<Action[]> =>
  JSON.parse(
    McpHarness.text(
      await harness.call('roam_update_page_markdown', {
        title: 'Numbered Fixture',
        markdown,
        dry_run: true,
      })
    )
  ).actions;

const AS_READ = [
  '- Numbered steps',
  '  - Step one',
  '  - Step two',
  '- Plain list',
  '  - Item one',
].join('\n');

describe('roam_update_page_markdown: numbered lists', () => {
  it('plans nothing when the page is written back as it reads, bullets and all', async () => {
    const read = McpHarness.text(
      await harness.call('roam_fetch_page_by_title', { title: 'Numbered Fixture', format: 'markdown' })
    );
    expect(read.split('\n').slice(2).join('\n')).toBe(AS_READ);

    expect(await plan(AS_READ)).toEqual([]);
  });

  it('makes an existing parent numbered when its items are written as numbered', async () => {
    const actions = await plan(AS_READ.replace('  - Item one', '  1. Item one'));

    expect(actions).toEqual([
      { action: 'update-block', block: { uid: 'numplain1', 'children-view-type': 'numbered' } },
    ]);
  });

  it('creates a new parent as numbered, with the numbers out of its items', async () => {
    const actions = await plan(`${AS_READ}\n- New steps\n  1. Alpha\n  2. Beta`);

    const creates = actions.filter((a) => a.action === 'create-block');
    expect(creates.map((a) => a.block.string)).toEqual(['New steps', 'Alpha', 'Beta']);
    expect(creates[0].block['children-view-type']).toBe('numbered');
    expect(creates[1].block['children-view-type']).toBeUndefined();
    expect(actions.filter((a) => a.action !== 'create-block')).toEqual([]);
  });

  it('plans nothing for a parent that is numbered already', async () => {
    const actions = await plan(
      AS_READ.replace('  - Step one', '  1. Step one').replace('  - Step two', '  2. Step two')
    );

    expect(actions).toEqual([]);
  });
});
