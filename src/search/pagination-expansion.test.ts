import { describe, expect, it, vi } from 'vitest';
import type { Graph } from '@roam-research/roam-api-sdk';

vi.mock('@roam-research/roam-api-sdk', () => ({ q: vi.fn() }));
import { q } from '@roam-research/roam-api-sdk';
import { SearchOperations } from '../tools/operations/search/index.js';

describe('reference work follows visible pagination', () => {
  it('does not expand references in hidden, filtered or unselected rows', async () => {
    vi.mocked(q).mockImplementation(async (_graph, query) => {
      if (query.includes(':find ?block-uid ?block-str')) return [
        ['a00000000', 'hidden ((hiddenRef)) #.rm-hide', 'Page'],
        ['b00000000', 'exclude ((filterRef))', 'Page'],
        ['c00000000', 'keep ((chosenRef))', 'Page'],
        ['d00000000', 'keep ((unusedRef))', 'Page'],
      ];
      if (query.includes(':find ?uid ?string')) return [['chosenRef', 'expanded']];
      return [];
    });
    const result = await new SearchOperations({} as Graph).searchByText({ text: '' }, {
      limit: 1, filter: match => !match.content.startsWith('exclude'),
    });
    expect(result.total_count).toBe(2);
    expect(result.matches.map(match => match.content)).toEqual(['keep expanded']);
    const refCalls = vi.mocked(q).mock.calls.filter(([, query]) => query.includes(':find ?uid ?string'));
    expect(refCalls.map(([, , inputs]) => inputs)).toEqual([[['chosenRef']]]);
    expect(vi.mocked(q).mock.calls.some(([, query]) => query.includes('(count '))).toBe(false);
  });

  it('leaves a reference unresolved when its target is withheld', async () => {
    vi.mocked(q).mockReset();
    vi.mocked(q).mockImplementation(async (_graph, query) => {
      if (query.includes(':find ?block-uid ?block-str')) return [
        ['a00000000', 'visible ((hiddenRef))', 'Page'],
      ];
      if (query.includes(':find ?uid ?s') && query.includes('.rm-hide')) return [
        ['hiddenRef', 'secret #.rm-hide'],
      ];
      if (query.includes(':find ?uid ?string')) throw new Error('must not fetch hidden content');
      return [];
    });
    const result = await new SearchOperations({} as Graph).searchByText({ text: 'visible', limit: 1 });
    expect(result.matches.map(match => match.content)).toEqual(['visible ((hiddenRef))']);
  });
});
