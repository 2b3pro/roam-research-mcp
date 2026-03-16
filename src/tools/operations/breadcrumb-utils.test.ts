import { describe, it, expect } from 'vitest';
import { reconstructBreadcrumbChains } from './breadcrumb-utils.js';

type ParentMap = Map<string, { uid: string; string: string }>;

describe('reconstructBreadcrumbChains', () => {
  it('returns empty chain when block has no parent', () => {
    const result = reconstructBreadcrumbChains(['blockA'], new Map());
    expect(result['blockA']).toEqual([]);
  });

  it('returns empty object for empty blockUids list', () => {
    const result = reconstructBreadcrumbChains([], new Map());
    expect(result).toEqual({});
  });

  it('reconstructs a single-level parent chain', () => {
    const map: ParentMap = new Map([
      ['blockA', { uid: 'parent1', string: 'Parent text' }]
    ]);
    const result = reconstructBreadcrumbChains(['blockA'], map);
    expect(result['blockA']).toEqual([{ uid: 'parent1', string: 'Parent text' }]);
  });

  it('reconstructs a multi-level chain in root-first order', () => {
    // blockA → parent1 → grandparent
    const map: ParentMap = new Map([
      ['blockA',  { uid: 'parent1',     string: 'Level 1' }],
      ['parent1', { uid: 'grandparent', string: 'Level 0' }]
    ]);
    const result = reconstructBreadcrumbChains(['blockA'], map);
    expect(result['blockA']).toEqual([
      { uid: 'grandparent', string: 'Level 0' },
      { uid: 'parent1',     string: 'Level 1' }
    ]);
  });

  it('handles deeply nested chains', () => {
    const map: ParentMap = new Map([
      ['d', { uid: 'c', string: 'C' }],
      ['c', { uid: 'b', string: 'B' }],
      ['b', { uid: 'a', string: 'A' }]
    ]);
    const result = reconstructBreadcrumbChains(['d'], map);
    expect(result['d'].map(x => x.string)).toEqual(['A', 'B', 'C']);
  });

  it('handles multiple blocks independently', () => {
    const map: ParentMap = new Map([
      ['block1', { uid: 'p1', string: 'Parent 1' }],
      ['block2', { uid: 'p2', string: 'Parent 2' }]
    ]);
    const result = reconstructBreadcrumbChains(['block1', 'block2'], map);
    expect(result['block1']).toEqual([{ uid: 'p1', string: 'Parent 1' }]);
    expect(result['block2']).toEqual([{ uid: 'p2', string: 'Parent 2' }]);
  });

  it('stops at page level (block with no parent in map)', () => {
    // parent1 has no entry — simulates a page node that stopped the query
    const map: ParentMap = new Map([
      ['blockA', { uid: 'parent1', string: 'Only parent' }]
      // parent1 intentionally absent (it's a page node)
    ]);
    const result = reconstructBreadcrumbChains(['blockA'], map);
    expect(result['blockA']).toEqual([{ uid: 'parent1', string: 'Only parent' }]);
  });

  it('detects and stops on circular parent chains', () => {
    // A → B → A (circular)
    const map: ParentMap = new Map([
      ['blockA', { uid: 'B', string: 'Node B' }],
      ['B',      { uid: 'blockA', string: 'Node A' }]
    ]);
    // should not loop forever
    const result = reconstructBreadcrumbChains(['blockA'], map);
    // chain terminates; exact content less important than not hanging
    expect(Array.isArray(result['blockA'])).toBe(true);
  });

  it('returns an empty chain for a block uid not in any chain', () => {
    const map: ParentMap = new Map([
      ['otherBlock', { uid: 'p', string: 'Parent' }]
    ]);
    const result = reconstructBreadcrumbChains(['orphan'], map);
    expect(result['orphan']).toEqual([]);
  });
});
