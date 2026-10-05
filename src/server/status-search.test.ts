import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * `roam_search_by_status` at the wire.
 *
 * Through 5.0.0 the tool searched for the text `{{TODO`, on the belief that it
 * matched both spellings of the marker. It does not: `{{[[TODO]]}}`, the form
 * Roam's checkbox and `roam_add_todo` write, has `[[` where that needs `TODO`.
 * On a real graph the tool returned 1 task out of 4,223.
 *
 * `src/search/status-search.test.ts` checks which markers the handler passes
 * as inputs. These check what a client gets back, against a fake backend that
 * matches only on the inputs the query's `includes?` clauses really test — so
 * a query that binds both spellings and uses one fails here.
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

const search = async (args: Record<string, unknown>) =>
  JSON.parse(McpHarness.text(await harness.call('roam_search_by_status', args)));

const uids = async (args: Record<string, unknown>) =>
  ((await search(args)).matches as { block_uid: string }[]).map((m) => m.block_uid).sort();

describe('roam_search_by_status finds both spellings of a marker', () => {
  it('returns {{[[TODO]]}} and {{TODO}} blocks across the graph', async () => {
    expect(await uids({ status: 'TODO' })).toEqual(['stBareTod', 'stBrkTodo', 'stOthTodo']);
  });

  it('returns {{[[DONE]]}} and {{DONE}} blocks across the graph', async () => {
    expect(await uids({ status: 'DONE' })).toEqual(['stBareDon', 'stBrkDone']);
  });

  it('names the page each match is on', async () => {
    const { matches } = await search({ status: 'TODO' });
    const other = matches.find((m: { block_uid: string }) => m.block_uid === 'stOthTodo');
    expect(other.page_title).toBe('Status Other');
    expect(other.content).toBe('{{[[TODO]]}} task on another page');
  });
});

describe('roam_search_by_status scoped to a page', () => {
  it('finds both spellings on that page and nothing from another', async () => {
    expect(await uids({ status: 'TODO', page_title_uid: 'Status Fixture' })).toEqual([
      'stBareTod',
      'stBrkTodo',
    ]);
  });

  it('accepts the page UID as well as its title', async () => {
    expect(await uids({ status: 'TODO', page_title_uid: 'statusPg2' })).toEqual(['stOthTodo']);
  });
});

describe('roam_search_by_status respects the hide filter', () => {
  it('withholds a task tagged #.rm-hide', async () => {
    // More results is the whole point of the fix, which makes this the moment
    // a withheld task would start leaking if the filter were not applied.
    expect(await uids({ status: 'TODO' })).not.toContain('stHidTodo');
  });
});
