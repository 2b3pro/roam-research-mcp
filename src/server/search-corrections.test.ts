import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpHarness } from './testing/mcp-harness.js';

const harness = new McpHarness({
  preload: './tests/fake-roam-backend.mjs',
  env: { ROAM_API_TOKEN: 'fake-token-for-tests', ROAM_GRAPH_NAME: 'fake-graph', TZ: 'America/Los_Angeles' },
});
beforeAll(() => harness.start(), 20000);
afterAll(() => harness.stop());

async function search(tool: string, args: Record<string, unknown>) {
  const result = await harness.call(tool, args);
  expect(result.isError, McpHarness.text(result)).toBeFalsy();
  return JSON.parse(McpHarness.text(result));
}
const dateArgs = { start_date: '2026-10-01', end_date: '2026-10-01', type: 'created', scope: 'blocks' };
const byDate = (args: Record<string, unknown> = {}) => search('roam_search_by_date', { ...dateArgs, ...args });

describe('date search uses stored timestamps', () => {
  it('finds ordinary text by creation time, through the last millisecond of the end date', async () => {
    const { matches } = await byDate();
    expect(matches.map((m: { uid: string }) => m.uid)).toEqual(['long00001', 'vis000001', 'near00001']);
    expect(matches.find((m: { uid: string }) => m.uid === 'vis000001')).toMatchObject({
      content: 'First visible block', type: 'block', page_title: 'Test Page',
      time: Date.parse('2026-10-01T12:00:00-07:00'),
    });
  });

  it('uses the stored edit time instead of the current time', async () => {
    const { matches } = await byDate({ type: 'modified' });
    expect(matches.map((m: { uid: string }) => m.uid)).toEqual(['vis000002', 'near00001']);
  });

  it('matches either timestamp and returns each entity once using its latest matching timestamp', async () => {
    const { matches } = await byDate({ type: 'both' });
    expect(matches.map((m: { uid: string }) => m.uid)).toEqual(['long00001', 'vis000001', 'vis000002', 'near00001']);
    expect(matches.find((m: { uid: string }) => m.uid === 'near00001').time)
      .toBe(Date.parse('2026-10-01T10:00:00-07:00'));
  });

  it('returns pages when the requested scope is pages', async () => {
    expect((await byDate({ scope: 'pages' })).matches).toEqual([{
      uid: 'page00001', type: 'page', time: Date.parse('2026-10-01T06:00:00-07:00'),
      content: 'Test Page', page_title: 'Test Page',
    }]);
  });

  it('returns both entity types when requested', async () => {
    const { matches } = await byDate({ scope: 'both', type: 'modified' });
    expect(matches.map((m: { uid: string }) => m.uid).sort()).toEqual(['bslashPg1', 'near00001', 'vis000002']);
    expect(matches.find((m: { uid: string }) => m.uid === 'bslashPg1').type).toBe('page');
  });

  it('withholds hidden blocks and descendants of hidden blocks', async () => {
    const { matches } = await byDate();
    const uids = matches.map((m: { uid: string }) => m.uid);
    expect(uids).not.toContain('hid000001');
    expect(uids).not.toContain('hidchild1');
  });

  it('omits content only when explicitly requested', async () => {
    const { matches } = await byDate({ include_content: false });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m: object) => !('content' in m))).toBe(true);
  });

  it('supports an open-ended range', async () => {
    const { matches } = await search('roam_search_by_date', { start_date: '2026-10-02', type: 'created', scope: 'blocks' });
    expect(matches.map((m: { uid: string }) => m.uid)).toEqual(['soft00001']);
  });

  it('uses calendar boundaries on a daylight-saving transition', async () => {
    const { matches } = await byDate({ start_date: '2026-03-08', end_date: '2026-03-08' });
    expect(matches.map((m: { uid: string }) => m.uid)).toEqual(['caseMix01']);
  });

  it.each([
    { start_date: '2026-02-30' }, { end_date: 'invalid' },
    { start_date: '2026-10-02', end_date: '2026-10-01' },
  ])('rejects invalid or reversed dates: %j', async (args) => {
    const result = await harness.call('roam_search_by_date', { ...dateArgs, ...args });
    expect(result.isError).toBe(true);
  });
});

describe('case-insensitive search', () => {
  const textSearch = (text: string, extra: Record<string, unknown> = {}) =>
    search('roam_search_by_text', { text, page_title_uid: 'Search Fixture', ...extra });

  it('finds arbitrary mixed capitalization', async () => {
    const { matches, total_count } = await textSearch('api client');
    expect(matches.map((m: { block_uid: string }) => m.block_uid).sort()).toEqual(['caseLow01', 'caseMix01']);
    expect(total_count).toBe(2);
  });

  it('preserves explicitly case-sensitive matching', async () => {
    const { matches } = await textSearch('api client', { case_sensitive: true });
    expect(matches.map((m: { block_uid: string }) => m.block_uid)).toEqual(['caseLow01']);
  });

  it('matches Unicode capitalization', async () => {
    const { matches } = await textSearch('äpi client');
    expect(matches.map((m: { block_uid: string }) => m.block_uid)).toEqual(['caseUni01']);
  });

  it.each(['a.b[0]', '"quoted"', 'C:\\newdir'])('treats %s as literal text', async text => {
    const { matches } = await textSearch(text);
    expect(matches.map((m: { block_uid: string }) => m.block_uid)).toEqual(['caseLit01']);
  });

  it('matches mixed-case tags as whole titles', async () => {
    const { matches } = await search('roam_search_for_tag', { primary_tag: 'apitag' });
    expect(matches.map((m: { block_uid: string }) => m.block_uid)).toEqual(['caseTag01']);
  });

  it('honors explicit case sensitivity for tags through the MCP boundary', async () => {
    const missed = await search('roam_search_for_tag', { primary_tag: 'apitag', case_sensitive: true });
    expect(missed.matches).toEqual([]);
    const matched = await search('roam_search_for_tag', { primary_tag: 'aPiTag', case_sensitive: true });
    expect(matched.matches.map((m: { block_uid: string }) => m.block_uid)).toEqual(['caseTag01']);
  });
});
