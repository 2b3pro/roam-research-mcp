import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { McpHarness } from './testing/mcp-harness.js';

const env = { ROAM_API_TOKEN: 'fake-token', ROAM_GRAPH_NAME: 'fake-graph' };
const harness = new McpHarness({ preload: './tests/fake-roam-backend.mjs', env });
beforeAll(() => harness.start(), 20000);
afterAll(() => harness.stop());

async function call(tool: string, args: Record<string, unknown>) {
  const result = await harness.call(tool, args);
  expect(result.isError, McpHarness.text(result)).toBeFalsy();
  return JSON.parse(McpHarness.text(result));
}

describe('MCP visible-result pagination', () => {
  it.each([
    ['roam_search_for_tag', { primary_tag: 'PagingTag' }],
    ['roam_search_by_text', { text: 'paging item', page_title_uid: 'Pagination Fixture' }],
  ])('honors limits, offsets and defaults through %s', async (tool, args) => {
    const first = await call(tool, { ...args, limit: 2 });
    expect(first.matches.map((m: any) => m.block_uid)).toEqual(['pag000001', 'pag000002']);
    const next = await call(tool, { ...args, limit: 2, offset: 2 });
    expect(next.matches.map((m: any) => m.block_uid)).toEqual(['pag000003', 'pag000004']);
    expect(next.total_count).toBe(tool === 'roam_search_for_tag' ? 60 : 61);
    expect((await call(tool, args)).matches).toHaveLength(50);
    expect((await call(tool, { ...args, limit: 0 })).matches).toEqual([]);
    expect((await call(tool, { ...args, limit: -1, offset: 59 })).matches).toHaveLength(tool === 'roam_search_for_tag' ? 1 : 2);
  });

  it('sorts namespace titles before slicing', async () => {
    const result = await call('roam_search_by_text', { text: 'Paging', scope: 'page_titles', limit: 1, offset: 1 });
    expect(result.matches.map((m: any) => m.page_title)).toEqual(['Paging/Middle']);
    expect(result.total_count).toBe(3);
  });

  it.each([{ limit: -2 }, { limit: 1.5 }, { limit: '2' }, { offset: -1 }, { offset: 0.5 }])('rejects an invalid window: %j', async page => {
    const result = await harness.call('roam_search_for_tag', { primary_tag: 'PagingTag', ...page });
    expect(result.isError).toBe(true);
  });
});

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', './tests/fake-roam-backend.mjs', 'build/cli/roam.js', 'search', ...args, '--json'], {
    encoding: 'utf8', env: { ...process.env, ...env, ROAM_GRAPHS: '', ROAM_DEFAULT_GRAPH: '' }, input: '',
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe('CLI pagination after filters', () => {
  it('applies AND and exclusion filters before selecting a page', () => {
    expect(cli('paging item', '--tag', 'PagingTag', '--tag', 'OtherPagingTag', '--limit', '2', '--offset', '1').map((m: any) => m.block_uid))
      .toEqual(['pag000003', 'pag000005']);
    expect(cli('paging item', '--negtag', 'OtherPagingTag', '--limit', '2').map((m: any) => m.block_uid))
      .toEqual(['pag000002', 'pag000004']);
  });

  it('includes matches found only through a later OR tag', () => {
    const result = cli('--tag', 'PagingTag', '--tag', 'OtherPagingTag', '--any', '--limit', '-1');
    expect(result).toHaveLength(61);
    expect(result.at(-1).block_uid).toBe('pag000061');
  });
});
