import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Graph } from '@roam-research/roam-api-sdk';

const q = vi.fn();
vi.mock('@roam-research/roam-api-sdk', () => ({ q: (...args: unknown[]) => q(...args) }));

import { StatusSearchHandler } from './status-search.js';

const graph = {} as Graph;
const OLD = Date.now() - 100 * 86_400_000;

// Rows as [uid, string, page title, create time, edit time]. The fake `q`
// returns the rows whose string contains any of the string inputs it was
// given, which is what the query's `includes?` clauses do in Roam.
const ROWS: [string, string, string, number, number][] = [
  ['brk000001', '{{[[TODO]]}} bracketed task', 'Page', OLD, OLD],
  ['bare00001', '{{TODO}} bare task', 'Page', OLD, OLD],
  ['done00001', '{{[[DONE]]}} finished task', 'Page', OLD, OLD],
  ['text00001', 'not a task', 'Page', OLD, OLD],
];

beforeEach(() => {
  q.mockReset();
  q.mockImplementation(async (_graph: Graph, _query: string, inputs: string[]) =>
    ROWS.filter(([, str]) => inputs.some(marker => str.includes(marker)))
  );
});

describe('status markers', () => {
  it('roam_search_by_status finds both {{[[TODO]]}} and {{TODO}}', async () => {
    const result = await new StatusSearchHandler(graph, { status: 'TODO' }).execute();
    expect(result.matches.map(m => m.block_uid).sort()).toEqual(['bare00001', 'brk000001']);
    expect(q.mock.calls[0][2]).toEqual(['{{[[TODO]]}}', '{{TODO']);
  });

  it('roam_search_by_status finds {{[[DONE]]}}', async () => {
    const result = await new StatusSearchHandler(graph, { status: 'DONE' }).execute();
    expect(result.matches.map(m => m.block_uid)).toEqual(['done00001']);
  });
});
