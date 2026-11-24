import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * Block versions at the wire.
 *
 * Giving a block a new version in Roam leaves the old text behind as a block
 * of its own: its own UID, its own children, the same page. It drops out of
 * `:block/children`, so a page read never shows it, but it keeps its string,
 * its tags and its page, so every search that matches blocks by attribute
 * returned it as if it were live. A superseded `{{[[TODO]]}}` came back as an
 * open task. And a fetch of the block in use gave no sign that versions exist.
 *
 * Fixture (tests/fake-roam-backend.mjs), page "Version Fixture":
 *   verActiv1  the version in use, with a child verActCh1
 *   verOld001  superseded, a {{[[TODO]]}}, with a child verOldCh1
 *   verOld002  superseded, same tag and same page link as the version in use
 *   verOldHid  superseded and tagged #.rm-hide
 *   verPlain1  a block that was never versioned
 * Every one of them contains "verneedle".
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

const call = async (tool: string, args: Record<string, unknown>) =>
  JSON.parse(McpHarness.text(await harness.call(tool, args)));

const uidsOf = (matches: Array<{ block_uid?: string; uid?: string }>) =>
  matches.map((m) => m.block_uid ?? m.uid).sort();

/** What is live on the page: the block in use, its child, and the plain block. */
const LIVE = ['verActCh1', 'verActiv1', 'verPlain1'];

describe('searches leave superseded versions out', () => {
  it('text search returns the version in use, not the old ones or their children', async () => {
    const result = await call('roam_search_by_text', { text: 'verneedle' });

    expect(uidsOf(result.matches)).toEqual(LIVE);
  });

  it('text search counts only what it returns', async () => {
    const result = await call('roam_search_by_text', { text: 'verneedle', limit: 1 });

    expect(result.matches).toHaveLength(1);
    expect(result.total_count ?? LIVE.length).toBe(LIVE.length);
  });

  it('status search does not report a superseded TODO as an open task', async () => {
    const result = await call('roam_search_by_status', { status: 'TODO', page_title_uid: 'Version Fixture' });

    expect(uidsOf(result.matches)).toEqual([]);
  });

  it('tag search returns the version in use only', async () => {
    const result = await call('roam_search_for_tag', { primary_tag: 'VersionTag' });

    expect(uidsOf(result.matches)).toEqual(['verActiv1']);
  });

  it('date search returns the version in use only', async () => {
    const result = await call('roam_search_by_date', {
      start_date: '2026-05-01',
      end_date: '2026-05-03',
      type: 'created',
      scope: 'blocks',
    });

    expect(uidsOf(result.matches)).toEqual(['verActiv1', 'verPlain1']);
  });

  it('linked references list the version in use only', async () => {
    const text = McpHarness.text(
      await harness.call('roam_fetch_page_full_view', { title: 'Version Target' })
    );

    expect(text).toContain('Final wording verneedle');
    expect(text).not.toContain('Second draft verneedle');
  });
});

describe('a page read shows the version in use, as before', () => {
  it('has no superseded version and no versions list', async () => {
    const text = McpHarness.text(
      await harness.call('roam_fetch_page_by_title', { title: 'Version Fixture', format: 'raw' })
    );

    expect(text).toContain('Final wording verneedle');
    expect(text).not.toContain('first draft');
    expect(text).not.toContain('Second draft');
    expect(text).not.toContain('versions');
  });
});

describe('roam_fetch_block lists the versions of a block', () => {
  it('lists every version oldest first and flags the one in use', async () => {
    const block = await call('roam_fetch_block', { block_uid: 'verActiv1' });

    expect(block.string).toBe('Final wording verneedle #[[VersionTag]] [[Version Target]]');
    expect(block.versions).toEqual([
      { uid: 'verOld001', string: '{{[[TODO]]}} first draft verneedle', active: false },
      { uid: 'verOld002', string: 'Second draft verneedle #[[VersionTag]] [[Version Target]]', active: false },
      { uid: 'verActiv1', string: 'Final wording verneedle #[[VersionTag]] [[Version Target]]', active: true },
    ]);
  });

  it('withholds a version the user tagged #.rm-hide', async () => {
    const block = await call('roam_fetch_block', { block_uid: 'verActiv1' });

    expect(JSON.stringify(block.versions)).not.toContain('Secret draft');
    expect(block.versions.map((v: { uid: string }) => v.uid)).not.toContain('verOldHid');
  });

  it('still fetches a superseded version by its UID, with its own children, and shows it is not the one in use', async () => {
    const block = await call('roam_fetch_block', { block_uid: 'verOld001' });

    expect(block.string).toBe('{{[[TODO]]}} first draft verneedle');
    expect(block.children.map((c: { uid: string }) => c.uid)).toEqual(['verOldCh1']);
    expect(block.versions.find((v: { uid: string }) => v.uid === 'verOld001').active).toBe(false);
    expect(block.versions.find((v: { active: boolean }) => v.active).uid).toBe('verActiv1');
  });

  it('adds nothing to a block that has no versions', async () => {
    const block = await call('roam_fetch_block', { block_uid: 'verPlain1' });

    expect(block.string).toBe('Plain block, never versioned verneedle');
    expect(block).not.toHaveProperty('versions');
  });
});

describe('the CLI follows the same rules', () => {
  const roam = (...args: string[]) => {
    // An inherited ROAM_GRAPHS outranks the single-graph vars and would aim the
    // run at a real graph.
    const env: Record<string, string | undefined> = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('ROAM_')) delete env[key];
    }
    const result = spawnSync('node', ['--import', './tests/fake-roam-backend.mjs', 'build/cli/roam.js', ...args], {
      env: { ...env, ROAM_API_TOKEN: 'fake-token-for-tests', ROAM_GRAPH_NAME: 'fake-graph' } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 15000,
    });
    return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
  };

  it('roam search leaves superseded versions out', () => {
    const run = roam('search', 'verneedle', '--json');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(uidsOf(JSON.parse(run.stdout))).toEqual(LIVE);
  });

  it('roam get --json carries the versions list', () => {
    const run = roam('get', 'verActiv1', '--json');

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).versions.map((v: { uid: string; active: boolean }) => [v.uid, v.active]))
      .toEqual([['verOld001', false], ['verOld002', false], ['verActiv1', true]]);
  });

  it('roam get prints the versions under the block, oldest first, marking the one in use', () => {
    const run = roam('get', 'verActiv1');

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('- Final wording verneedle');
    const versions = run.stdout.slice(run.stdout.indexOf('Versions'));
    expect(versions.split('\n')).toEqual([
      'Versions (3, oldest first, * marks the one in use):',
      '  ((verOld001)) {{[[TODO]]}} first draft verneedle',
      '  ((verOld002)) Second draft verneedle #[[VersionTag]] [[Version Target]]',
      '* ((verActiv1)) Final wording verneedle #[[VersionTag]] [[Version Target]]',
    ]);
  });

  it('roam get prints a block with no versions exactly as before', () => {
    const run = roam('get', 'verPlain1');

    expect(run.code).toBe(0);
    expect(run.stdout).toBe('- Plain block, never versioned verneedle');
  });
});
