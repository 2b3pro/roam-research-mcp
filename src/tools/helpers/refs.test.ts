import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph } from '@roam-research/roam-api-sdk';
vi.mock('@roam-research/roam-api-sdk', () => ({ q: vi.fn() }));
import { q } from '@roam-research/roam-api-sdk';
import { resolveRefsMany, resolveRefsInTrees } from './refs.js';

let texts: Record<string, string>;
beforeEach(() => {
  texts = { aaaaaaaaa: 'A ((sharedUID))', bbbbbbbbb: 'B ((sharedUID))', sharedUID: 'shared' };
  vi.mocked(q).mockReset();
  vi.mocked(q).mockImplementation(async (_graph, query, inputs) => {
    if (query.includes('.rm-hide')) return [];
    return (inputs[0] as string[]).filter(uid => uid in texts).map(uid => [uid, texts[uid]]);
  });
});
const referenceCalls = () => vi.mocked(q).mock.calls.filter(([, query]) => query.includes(':find ?uid ?string'));

describe('batched reference expansion', () => {
  it('fetches shared targets once and expands them in every branch', async () => {
    expect(await resolveRefsMany({} as Graph, ['((aaaaaaaaa)) and ((bbbbbbbbb))', 'again ((sharedUID))']))
      .toEqual(['A shared and B shared', 'again shared']);
    expect(referenceCalls()).toHaveLength(1);
    expect(new Set(referenceCalls()[0][2][0])).toEqual(new Set(['aaaaaaaaa', 'bbbbbbbbb', 'sharedUID']));
  });

  it('uses one request per frontier and preserves the depth bound', async () => {
    expect(await resolveRefsMany({} as Graph, ['((aaaaaaaaa))', '((bbbbbbbbb))'], 1))
      .toEqual(['A ((sharedUID))', 'B ((sharedUID))']);
    expect(referenceCalls()).toHaveLength(1);
  });

  it('keeps cycles and missing targets finite without suppressing siblings', async () => {
    texts.sharedUID = 'shared ((aaaaaaaaa))';
    const result = await resolveRefsMany({} as Graph, ['((aaaaaaaaa)) ((missingID))', '((bbbbbbbbb)) ((missingID))']);
    expect(result).toEqual(['A shared ((aaaaaaaaa)) ((missingID))', 'B shared A ((sharedUID)) ((missingID))']);
    const asked = referenceCalls().flatMap(([, , inputs]) => inputs[0]);
    expect(asked.filter(uid => uid === 'missingID')).toHaveLength(1);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('reuses loaded forest content and leaves the input intact', async () => {
    const blocks = [{ uid: 'aaaaaaaaa', string: 'loaded', order: 0, children: [] },
      { uid: 'bbbbbbbbb', string: '((aaaaaaaaa))', order: 1, children: [] }];
    const result = await resolveRefsInTrees({} as Graph, blocks, 2);
    expect(result[1].string).toBe('loaded');
    expect(blocks[1].string).toBe('((aaaaaaaaa))');
    expect(referenceCalls()).toHaveLength(0);
  });

  it('does not cache content across calls or graph connections', async () => {
    const graph = {} as Graph;
    expect(await resolveRefsMany(graph, ['((sharedUID))'])).toEqual(['shared']);
    texts.sharedUID = 'edited';
    expect(await resolveRefsMany(graph, ['((sharedUID))'])).toEqual(['edited']);
    expect(await resolveRefsMany({} as Graph, ['((sharedUID))'])).toEqual(['edited']);
    expect(referenceCalls()).toHaveLength(3);
  });

  it('chunks a large frontier without losing results', async () => {
    const uids = Array.from({ length: 401 }, (_, i) => `r${String(i).padStart(8, '0')}`);
    texts = Object.fromEntries(uids.map(uid => [uid, uid]));
    expect(await resolveRefsMany({} as Graph, uids.map(uid => `((${uid}))`))).toEqual(uids);
    expect(referenceCalls().map(([, , inputs]) => inputs[0].length)).toEqual([200, 200, 1]);
  });
});
