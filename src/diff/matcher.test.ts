import { describe, it, expect } from 'vitest';
import { normalizeText, normalizeForMatching, matchBlocks, groupByParent } from './matcher.js';
import type { ExistingBlock, NewBlock } from './types.js';

describe('normalizeText', () => {
  it('trims whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
    expect(normalizeText('\thello\n')).toBe('hello');
  });

  it('preserves internal whitespace', () => {
    expect(normalizeText('hello world')).toBe('hello world');
  });

  it('handles empty strings', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText('   ')).toBe('');
  });
});

describe('normalizeForMatching', () => {
  it('removes numbered list prefixes', () => {
    expect(normalizeForMatching('1. First item')).toBe('First item');
    expect(normalizeForMatching('2. Second item')).toBe('Second item');
    expect(normalizeForMatching('10. Tenth item')).toBe('Tenth item');
  });

  it('preserves non-list text', () => {
    expect(normalizeForMatching('Regular text')).toBe('Regular text');
    expect(normalizeForMatching('- Bullet point')).toBe('- Bullet point');
  });

  it('trims whitespace', () => {
    expect(normalizeForMatching('  1. Item  ')).toBe('Item');
  });
});

describe('matchBlocks', () => {
  // Helper to create test blocks
  function createExisting(uid: string, text: string, order: number): ExistingBlock {
    return { uid, text, order, heading: null, children: [], parentUid: null };
  }

  function createNew(blockUid: string, text: string, order: number): NewBlock {
    return {
      ref: { blockUid },
      text,
      parentRef: null,
      order,
      open: true,
      heading: null,
    };
  }

  describe('Phase 1: Exact text match', () => {
    it('matches blocks with identical text', () => {
      const existing = [createExisting('uid1', 'Hello world', 0)];
      const newBlocks = [createNew('new1', 'Hello world', 0)];

      const matches = matchBlocks(existing, newBlocks);

      expect(matches.get('new1')).toBe('uid1');
    });

    it('matches multiple blocks with same text by position', () => {
      const existing = [
        createExisting('uid1', 'Item', 0),
        createExisting('uid2', 'Item', 1),
        createExisting('uid3', 'Item', 2),
      ];
      const newBlocks = [
        createNew('new1', 'Item', 0),
        createNew('new2', 'Item', 1),
      ];

      const matches = matchBlocks(existing, newBlocks);

      // Should prefer position-closest matches
      expect(matches.get('new1')).toBe('uid1');
      expect(matches.get('new2')).toBe('uid2');
    });

    it('handles no matches when too many unmatched for position fallback', () => {
      // Need >3 on each side to avoid position-based fallback
      const existing = [
        createExisting('uid1', 'A', 0),
        createExisting('uid2', 'B', 1),
        createExisting('uid3', 'C', 2),
        createExisting('uid4', 'D', 3),
      ];
      const newBlocks = [
        createNew('new1', 'W', 0),
        createNew('new2', 'X', 1),
        createNew('new3', 'Y', 2),
        createNew('new4', 'Z', 3),
      ];

      const matches = matchBlocks(existing, newBlocks);

      expect(matches.size).toBe(0);
    });

    it('uses position fallback when ≤3 unmatched on each side', () => {
      const existing = [createExisting('uid1', 'Hello', 0)];
      const newBlocks = [createNew('new1', 'Goodbye', 0)];

      const matches = matchBlocks(existing, newBlocks);

      // Position fallback matches by position
      expect(matches.size).toBe(1);
      expect(matches.get('new1')).toBe('uid1');
    });
  });

  describe('Phase 2: Normalized text match', () => {
    it('matches blocks when list prefix differs', () => {
      const existing = [createExisting('uid1', 'First item', 0)];
      const newBlocks = [createNew('new1', '1. First item', 0)];

      const matches = matchBlocks(existing, newBlocks);

      expect(matches.get('new1')).toBe('uid1');
    });

    it('matches numbered list items to plain text', () => {
      const existing = [
        createExisting('uid1', 'Apple', 0),
        createExisting('uid2', 'Banana', 1),
      ];
      const newBlocks = [
        createNew('new1', '1. Apple', 0),
        createNew('new2', '2. Banana', 1),
      ];

      const matches = matchBlocks(existing, newBlocks);

      expect(matches.get('new1')).toBe('uid1');
      expect(matches.get('new2')).toBe('uid2');
    });
  });

  describe('Phase 3: Position-based fallback', () => {
    it('matches by position when few unmatched blocks remain', () => {
      const existing = [
        createExisting('uid1', 'Completely different', 0),
        createExisting('uid2', 'Also different', 1),
      ];
      const newBlocks = [
        createNew('new1', 'Brand new text', 0),
        createNew('new2', 'Another new text', 1),
      ];

      const matches = matchBlocks(existing, newBlocks);

      // With ≤3 unmatched on each side, should use position fallback
      expect(matches.get('new1')).toBe('uid1');
      expect(matches.get('new2')).toBe('uid2');
    });

    it('does not use position fallback when too many unmatched', () => {
      const existing = [
        createExisting('uid1', 'A', 0),
        createExisting('uid2', 'B', 1),
        createExisting('uid3', 'C', 2),
        createExisting('uid4', 'D', 3),
      ];
      const newBlocks = [
        createNew('new1', 'W', 0),
        createNew('new2', 'X', 1),
        createNew('new3', 'Y', 2),
        createNew('new4', 'Z', 3),
      ];

      const matches = matchBlocks(existing, newBlocks);

      // With >3 unmatched, should not use position fallback
      expect(matches.size).toBe(0);
    });
  });

  describe('Mixed matching scenarios', () => {
    it('prioritizes exact match over normalized match', () => {
      const existing = [
        createExisting('uid1', '1. Item', 0),
        createExisting('uid2', 'Item', 1),
      ];
      const newBlocks = [createNew('new1', 'Item', 0)];

      const matches = matchBlocks(existing, newBlocks);

      // Should match exact text 'Item' not normalized '1. Item'
      expect(matches.get('new1')).toBe('uid2');
    });

    it('uses each existing block only once', () => {
      const existing = [createExisting('uid1', 'Same text', 0)];
      const newBlocks = [
        createNew('new1', 'Same text', 0),
        createNew('new2', 'Same text', 1),
      ];

      const matches = matchBlocks(existing, newBlocks);

      // Only one match should occur
      expect(matches.size).toBe(1);
      expect(matches.get('new1')).toBe('uid1');
      expect(matches.has('new2')).toBe(false);
    });
  });
});

describe('groupByParent', () => {
  function createExisting(
    uid: string,
    order: number,
    parentUid: string | null
  ): ExistingBlock {
    return { uid, text: '', order, heading: null, children: [], parentUid };
  }

  it('groups blocks by parent UID', () => {
    const blocks = [
      createExisting('a', 0, null),
      createExisting('b', 1, null),
      createExisting('c', 0, 'parent1'),
      createExisting('d', 1, 'parent1'),
      createExisting('e', 0, 'parent2'),
    ];

    const groups = groupByParent(blocks);

    expect(groups.get(null)?.map((b) => b.uid)).toEqual(['a', 'b']);
    expect(groups.get('parent1')?.map((b) => b.uid)).toEqual(['c', 'd']);
    expect(groups.get('parent2')?.map((b) => b.uid)).toEqual(['e']);
  });

  it('sorts blocks within each group by order', () => {
    const blocks = [
      createExisting('a', 2, null),
      createExisting('b', 0, null),
      createExisting('c', 1, null),
    ];

    const groups = groupByParent(blocks);

    expect(groups.get(null)?.map((b) => b.uid)).toEqual(['b', 'c', 'a']);
  });
});
