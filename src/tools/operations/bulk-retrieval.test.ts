import { describe, expect, it, vi } from 'vitest';
import type { Graph } from '@roam-research/roam-api-sdk';
vi.mock('@roam-research/roam-api-sdk', () => ({ q: vi.fn() }));
import { q } from '@roam-research/roam-api-sdk';
import { BlockRetrievalOperations } from './block-retrieval.js';

describe('bulk block retrieval', () => {
  it('shares root and child requests while preserving order, headings, hidden trees and missing roots', async () => {
    vi.mocked(q).mockReset();
    vi.mocked(q).mockImplementation(async (_graph, query, inputs) => {
      if (query.includes(':find ?uid ?string ?order')) return [
        ['rootAAAAA', 'first', 1, 2], ['rootBBBBB', 'second', 0, 0], ['hiddenUID', 'private #.rm-hide', 0, 0],
      ];
      if (query.includes(':find ?uid ?s') && query.includes('.rm-hide')) return [['hiddenUID', '#.rm-hide']];
      if (query.includes(':find ?parentUid')) return [
        ['rootAAAAA', 'childBBBB', 'later', 1, 0], ['rootAAAAA', 'childAAAA', 'earlier', 0, 1],
        ['rootBBBBB', 'childCCCC', 'other', 0, 0], ['rootBBBBB', 'childHIDE', '#.rm-hide', 1, 0],
      ];
      return [];
    });
    const result = await new BlockRetrievalOperations({} as Graph).fetchBlocks(['rootBBBBB', 'missingID', 'rootAAAAA', 'hiddenUID'], 1);
    expect(result.map(block => block?.uid ?? null)).toEqual(['rootBBBBB', null, 'rootAAAAA', null]);
    expect(result[0]?.children.map(block => block.uid)).toEqual(['childCCCC']);
    expect(result[2]?.heading).toBe(2);
    expect(result[2]?.children.map(block => [block.uid, block.heading])).toEqual([['childAAAA', 1], ['childBBBB', undefined]]);
    expect(vi.mocked(q).mock.calls.filter(([, query]) => query.includes(':find ?parentUid'))).toHaveLength(1);
    expect(vi.mocked(q).mock.calls.find(([, query]) => query.includes(':find ?parentUid'))?.[2]).toEqual([['rootAAAAA', 'rootBBBBB']]);
  });

  it('orders ancestors per root from shared ancestry and parent queries', async () => {
    vi.mocked(q).mockReset();
    vi.mocked(q).mockImplementation(async (_graph, query) => {
      if (query.includes(':find ?uid ?string ?order')) return [['rootAAAAA', 'deep', 0, 0], ['rootBBBBB', 'top', 1, 0]];
      if (query.includes(':find ?rootUid')) return [
        ['rootAAAAA', 'pageAAAAA', '', 'Page A'], ['rootAAAAA', 'parentAAA', 'parent', ''],
        ['rootBBBBB', 'pageBBBBB', '', 'Page B'],
      ];
      if (query.includes(':find ?childUid')) return [['rootAAAAA', 'parentAAA'], ['parentAAA', 'pageAAAAA'], ['rootBBBBB', 'pageBBBBB']];
      return [];
    });
    const result = await new BlockRetrievalOperations({} as Graph).fetchBlocks(['rootAAAAA', 'rootBBBBB'], 0, true);
    expect(result[0]?.ancestors?.map(a => [a.uid, a.depth])).toEqual([['parentAAA', 2], ['pageAAAAA', 0]]);
    expect(result.map(block => block?.page_title)).toEqual(['Page A', 'Page B']);
  });
});
