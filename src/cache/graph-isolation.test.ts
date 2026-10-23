import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph } from '@roam-research/roam-api-sdk';

vi.mock('@roam-research/roam-api-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@roam-research/roam-api-sdk')>(),
  q: vi.fn(),
  updatePage: vi.fn(),
}));

import { q, updatePage } from '@roam-research/roam-api-sdk';
import { getPageUidCache } from './page-uid-cache.js';
import { getPageUid } from '../tools/helpers/page-resolution.js';
import { resolvePageUid } from '../cli/batch/resolver.js';
import { uidExists } from '../shared/page-validator.js';
import { PageOperations } from '../tools/operations/pages.js';

beforeEach(() => vi.resetAllMocks());

describe('graph-scoped lookup evidence', () => {
  it('resolves an identical title independently through both MCP and CLI lookups', async () => {
    const a = { graph: 'a' } as Graph;
    const b = { graph: 'b' } as Graph;
    vi.mocked(q).mockImplementation(async graph => graph === a ? 'page-a' as any : 'page-b' as any);

    expect(await getPageUid(a, 'Shared title')).toBe('page-a');
    expect(await resolvePageUid(b, 'Shared title')).toBe('page-b');
    expect(await resolvePageUid(a, 'Shared title')).toBe('page-a');
    expect(await getPageUid(b, 'Shared title')).toBe('page-b');
    expect(q).toHaveBeenCalledTimes(2);
  });

  it('does not accept another connection’s cached UID as existence proof', async () => {
    const a = { graph: 'same-name' } as Graph;
    const b = { graph: 'same-name' } as Graph;
    vi.mocked(q).mockImplementation(async graph => graph === a ? [['sharedUid']] : []);

    expect(await uidExists(a, 'sharedUid')).toBe(true);
    expect(await uidExists(b, 'sharedUid')).toBe(false);
    expect(await uidExists(a, 'sharedUid')).toBe(true);
    expect(q).toHaveBeenCalledTimes(2);
  });

  it.each([{ old_title: 'Old title' }, { uid: 'page-a' }])('invalidates aliases after a successful rename: %j', async identifier => {
    const a = {} as Graph;
    const b = {} as Graph;
    getPageUidCache(a).set('Old title', 'page-a');
    getPageUidCache(a).set('Alternate lookup', 'page-a');
    getPageUidCache(b).set('Old title', 'page-b');
    vi.mocked(updatePage).mockResolvedValue(true);
    vi.mocked(q).mockResolvedValue(null as any);

    expect((await new PageOperations(a).renamePage({ ...identifier, new_title: 'New title' })).success).toBe(true);
    expect(await getPageUid(a, 'Old title')).toBeNull();
    expect(getPageUidCache(a).get('Alternate lookup')).toBeUndefined();
    expect(await getPageUid(b, 'Old title')).toBe('page-b');
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('keeps valid lookup evidence when a rename fails', async () => {
    const graph = {} as Graph;
    getPageUidCache(graph).set('Old title', 'page-a');
    vi.mocked(updatePage).mockResolvedValue(false);
    await new PageOperations(graph).renamePage({ old_title: 'Old title', new_title: 'New title' });
    expect(await getPageUid(graph, 'Old title')).toBe('page-a');
    expect(q).not.toHaveBeenCalled();
  });
});
