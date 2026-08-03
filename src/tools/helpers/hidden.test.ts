import { describe, it, expect } from 'vitest';
import {
  isHiddenBlockString,
  pruneHiddenBlocks,
  filterHiddenMatches,
} from './hidden.js';

describe('isHiddenBlockString', () => {
  it('matches all three Roam reference forms', () => {
    expect(isHiddenBlockString('secret #.rm-hide')).toBe(true);
    expect(isHiddenBlockString('secret #[[.rm-hide]]')).toBe(true);
    expect(isHiddenBlockString('secret [[.rm-hide]]')).toBe(true);
  });

  it('matches .rm-private as well as .rm-hide', () => {
    expect(isHiddenBlockString('salary #.rm-private')).toBe(true);
    expect(isHiddenBlockString('salary #[[.rm-private]]')).toBe(true);
    expect(isHiddenBlockString('salary [[.rm-private]]')).toBe(true);
  });

  it('matches regardless of position in the block', () => {
    expect(isHiddenBlockString('#.rm-hide leading')).toBe(true);
    expect(isHiddenBlockString('trailing #.rm-hide')).toBe(true);
    expect(isHiddenBlockString('in #.rm-hide the middle')).toBe(true);
  });

  it('does not match tags that merely start the same', () => {
    // The bug this guards: a `.rm-hide` substring check would hide all of these.
    expect(isHiddenBlockString('#.rm-hidden')).toBe(false);
    expect(isHiddenBlockString('#.rm-highlight')).toBe(false);
    expect(isHiddenBlockString('#.rm-hide-later')).toBe(false);
    expect(isHiddenBlockString('#.rm-privately')).toBe(false);
  });

  it('does not match unrelated Roam CSS tags', () => {
    expect(isHiddenBlockString('#.rm-E')).toBe(false);
    expect(isHiddenBlockString('a normal block')).toBe(false);
    expect(isHiddenBlockString('')).toBe(false);
    expect(isHiddenBlockString(null)).toBe(false);
    expect(isHiddenBlockString(undefined)).toBe(false);
  });

  it('is case-insensitive — over-hiding is the safe direction', () => {
    expect(isHiddenBlockString('#.RM-HIDE')).toBe(true);
    expect(isHiddenBlockString('[[.Rm-Private]]')).toBe(true);
  });
});

describe('pruneHiddenBlocks', () => {
  const tree = () => [
    { uid: 'a', string: 'visible a', children: [{ uid: 'a1', string: 'child a1', children: [] }] },
    {
      uid: 'b',
      string: 'secret b #.rm-hide',
      children: [{ uid: 'b1', string: 'child of secret', children: [] }],
    },
    {
      uid: 'c',
      string: 'visible c',
      children: [
        { uid: 'c1', string: 'nested secret #.rm-private', children: [{ uid: 'c1a', string: 'deep', children: [] }] },
        { uid: 'c2', string: 'nested visible', children: [] },
      ],
    },
  ];

  it('drops a hidden block and its entire subtree', () => {
    const out = pruneHiddenBlocks(tree());
    expect(out.map((b) => b.uid)).toEqual(['a', 'c']);
    // b1 was only reachable through the hidden b
    expect(JSON.stringify(out)).not.toContain('child of secret');
  });

  it('prunes at any depth', () => {
    const out = pruneHiddenBlocks(tree());
    const c = out.find((b) => b.uid === 'c')!;
    expect(c.children.map((b: { uid: string }) => b.uid)).toEqual(['c2']);
    expect(JSON.stringify(out)).not.toContain('deep');
  });

  it('keeps visible content untouched', () => {
    const out = pruneHiddenBlocks(tree());
    const a = out.find((b) => b.uid === 'a')!;
    expect(a.children.map((b: { uid: string }) => b.uid)).toEqual(['a1']);
  });

  it('does not mutate the input tree', () => {
    const input = tree();
    const snapshot = JSON.stringify(input);
    pruneHiddenBlocks(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('handles empty and childless input', () => {
    expect(pruneHiddenBlocks([])).toEqual([]);
    expect(pruneHiddenBlocks([{ uid: 'x', string: 'plain' }])).toEqual([{ uid: 'x', string: 'plain' }]);
  });

  it('drops everything when every root is hidden', () => {
    expect(pruneHiddenBlocks([{ uid: 'x', string: '#.rm-hide' }])).toEqual([]);
  });
});

describe('filterHiddenMatches', () => {
  const matches = [
    { block_uid: 'keep1', content: 'visible' },
    { block_uid: 'hide1', content: 'under a hidden parent' },
    { block_uid: 'keep2', content: 'also visible' },
    { block_uid: 'keep3', content: 'self-tagged #.rm-hide' },
  ];

  it('drops matches whose UID is in the hidden closure', () => {
    const out = filterHiddenMatches(matches, new Set(['hide1']));
    expect(out.map((m) => m.block_uid)).not.toContain('hide1');
  });

  it('drops self-tagged matches even when the closure missed them', () => {
    const out = filterHiddenMatches(matches, new Set());
    expect(out.map((m) => m.block_uid)).toEqual(['keep1', 'hide1', 'keep2']);
  });

  it('keeps everything when nothing is hidden', () => {
    const clean = [{ block_uid: 'a', content: 'x' }, { block_uid: 'b', content: 'y' }];
    expect(filterHiddenMatches(clean, new Set())).toHaveLength(2);
  });
});
