import { describe, it, expect } from 'vitest';
import { resolveParentRef, resolvePageRef, type UidExists } from './ref-resolver.js';

/** A graph holding exactly these UIDs, recording every lookup made against it. */
function graphWith(...uids: string[]): { exists: UidExists; lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    exists: async (uid) => {
      lookups.push(uid);
      return uids.includes(uid);
    },
  };
}

describe('resolveParentRef: --parent-uid', () => {
  it('resolves a digit-free UID that exists', async () => {
    const { exists } = graphWith('aBcDeFgHi');
    expect(await resolveParentRef({ parentUid: 'aBcDeFgHi' }, exists)).toEqual({
      kind: 'uid',
      uid: 'aBcDeFgHi',
    });
  });

  it('accepts the ((uid)) wrapper', async () => {
    const { exists } = graphWith('aBcDeFgHi');
    expect(await resolveParentRef({ parentUid: '((aBcDeFgHi))' }, exists)).toMatchObject({
      kind: 'uid',
      uid: 'aBcDeFgHi',
    });
  });

  it('throws, naming the UID, when the block does not exist', async () => {
    const { exists } = graphWith();
    await expect(resolveParentRef({ parentUid: 'zzzzzzzzz' }, exists)).rejects.toThrow(/zzzzzzzzz/);
  });

  it('rejects a value that is not UID-shaped without touching the graph', async () => {
    const { exists, lookups } = graphWith();
    await expect(resolveParentRef({ parentUid: '## Notes' }, exists)).rejects.toThrow(/--parent-uid/);
    expect(lookups).toEqual([]);
  });

  it('cannot be combined with --parent', async () => {
    const { exists, lookups } = graphWith('aBcDeFgHi');
    await expect(
      resolveParentRef({ parent: '## Notes', parentUid: 'aBcDeFgHi' }, exists)
    ).rejects.toThrow(/--parent.*--parent-uid|--parent-uid.*--parent/);
    expect(lookups).toEqual([]);
  });
});

describe('resolveParentRef: --parent is always text (5.0)', () => {
  it('returns undefined when neither flag is given', async () => {
    const { exists } = graphWith();
    expect(await resolveParentRef({}, exists)).toBeUndefined();
  });

  it('treats a wrapped UID as the text of a reference block, even when that block exists', async () => {
    const { exists, lookups } = graphWith('aBcDeFgHi');
    expect(await resolveParentRef({ parent: '((aBcDeFgHi))' }, exists)).toEqual({
      kind: 'heading',
      text: '((aBcDeFgHi))',
    });
    expect(lookups).toEqual([]);
  });

  it('treats a bare UID as text, even when that block exists', async () => {
    const { exists, lookups } = graphWith('aBcDeFgHi');
    expect(await resolveParentRef({ parent: 'aBcDeFgHi' }, exists)).toEqual({
      kind: 'heading',
      text: 'aBcDeFgHi',
    });
    expect(lookups).toEqual([]);
  });

  it('does not error on a wrapped UID that names nothing: it is text', async () => {
    const { exists, lookups } = graphWith();
    expect(await resolveParentRef({ parent: '((zzzzzzzzz))' }, exists)).toEqual({
      kind: 'heading',
      text: '((zzzzzzzzz))',
    });
    expect(lookups).toEqual([]);
  });

  it.each(['Learnings', 'Sprint_23', '## Notes', '((not a uid))', '[Title](((aBcDeFgHi)))'])(
    'keeps %j as text, with no lookup',
    async (text) => {
      const { exists, lookups } = graphWith('aBcDeFgHi');
      expect(await resolveParentRef({ parent: text }, exists)).toEqual({ kind: 'heading', text });
      expect(lookups).toEqual([]);
    }
  );
});

describe('resolvePageRef: --page', () => {
  it('REGRESSION v2.15.1: "Learnings" resolves by title, never as a raw UID', async () => {
    const { exists } = graphWith();
    expect(await resolvePageRef('Learnings', exists)).toEqual({ kind: 'title', title: 'Learnings' });
  });

  it('treats a wrapped digit-free UID as a UID', async () => {
    const { exists } = graphWith('aBcDeFgHi');
    expect(await resolvePageRef('((aBcDeFgHi))', exists)).toEqual({ kind: 'uid', uid: 'aBcDeFgHi' });
  });

  it('throws when a wrapped UID does not exist, instead of creating a page', async () => {
    const { exists } = graphWith();
    await expect(resolvePageRef('((zzzzzzzzz))', exists)).rejects.toThrow(/zzzzzzzzz/);
  });

  it('resolves a bare UID-shaped value as a UID when the graph has it', async () => {
    const { exists } = graphWith('pageUid12');
    expect(await resolvePageRef('pageUid12', exists)).toEqual({ kind: 'uid', uid: 'pageUid12' });
  });

  it('resolves a bare UID-shaped value as a title when the graph does not have it', async () => {
    const { exists } = graphWith();
    expect(await resolvePageRef('Sprint_23', exists)).toEqual({ kind: 'title', title: 'Sprint_23' });
  });

  it('keeps [[Title]] and ordinary titles as titles, with no lookup', async () => {
    const { exists, lookups } = graphWith();
    expect(await resolvePageRef('[[Learnings]]', exists)).toEqual({ kind: 'title', title: '[[Learnings]]' });
    expect(await resolvePageRef('Project X', exists)).toEqual({ kind: 'title', title: 'Project X' });
    expect(lookups).toEqual([]);
  });
});
