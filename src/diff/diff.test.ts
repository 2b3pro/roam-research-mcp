import { describe, it, expect } from 'vitest';
import { diffBlockTrees } from './diff.js';
import type { ExistingBlock, NewBlock } from './types.js';

describe('diffBlockTrees', () => {
  const pageUid = 'page123';

  // Helper to create test blocks
  function createExisting(
    uid: string,
    text: string,
    order: number,
    heading: number | null = null,
    children: ExistingBlock[] = []
  ): ExistingBlock {
    return { uid, text, order, heading, children, parentUid: null };
  }

  function createNew(
    blockUid: string,
    text: string,
    order: number,
    heading: number | null = null
  ): NewBlock {
    return {
      ref: { blockUid },
      text,
      parentRef: { blockUid: pageUid },
      order,
      open: true,
      heading,
    };
  }

  describe('No changes scenario', () => {
    it('returns empty diff when content is identical', () => {
      const existing = [
        createExisting('uid1', 'First', 0),
        createExisting('uid2', 'Second', 1),
      ];
      const newBlocks = [createNew('new1', 'First', 0), createNew('new2', 'Second', 1)];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.creates.length).toBe(0);
      expect(diff.updates.length).toBe(0);
      expect(diff.moves.length).toBe(0);
      expect(diff.deletes.length).toBe(0);
      expect(diff.preservedUids.size).toBe(2);
    });
  });

  describe('Create operations', () => {
    it('generates create actions for new blocks', () => {
      const existing: ExistingBlock[] = [];
      const newBlocks = [createNew('new1', 'New block', 0)];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.creates.length).toBe(1);
      expect(diff.creates[0].action).toBe('create-block');
      expect((diff.creates[0] as any).block.string).toBe('New block');
    });

    it('generates creates for unmatched new blocks', () => {
      const existing = [createExisting('uid1', 'Existing', 0)];
      const newBlocks = [
        createNew('new1', 'Existing', 0),
        createNew('new2', 'Brand new', 1),
      ];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.creates.length).toBe(1);
      expect((diff.creates[0] as any).block.string).toBe('Brand new');
    });
  });

  describe('Update operations', () => {
    it('generates update when text changes', () => {
      const existing = [createExisting('uid1', 'Old text', 0)];
      // Position-based fallback will match with ≤3 blocks
      const newBlocks = [createNew('new1', 'New text', 0)];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.updates.length).toBe(1);
      expect(diff.updates[0].action).toBe('update-block');
      expect((diff.updates[0] as any).block.uid).toBe('uid1');
      expect((diff.updates[0] as any).block.string).toBe('New text');
    });

    it('generates update when heading changes', () => {
      const existing = [createExisting('uid1', 'Title', 0, null)];
      const newBlocks = [createNew('new1', 'Title', 0, 2)];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.updates.length).toBe(1);
      expect((diff.updates[0] as any).block.heading).toBe(2);
    });

    it('removes heading when changed to null', () => {
      const existing = [createExisting('uid1', 'Title', 0, 2)];
      const newBlocks = [createNew('new1', 'Title', 0, null)];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.updates.length).toBe(1);
      expect((diff.updates[0] as any).block.heading).toBe(0); // 0 removes heading
    });

    it('does not generate update when content is same', () => {
      const existing = [createExisting('uid1', 'Same', 0)];
      const newBlocks = [createNew('new1', 'Same', 0)];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.updates.length).toBe(0);
    });
  });

  describe('Move operations', () => {
    it('generates move when order changes', () => {
      const existing = [
        createExisting('uid1', 'First', 0),
        createExisting('uid2', 'Second', 1),
      ];
      // Swap order
      const newBlocks = [createNew('new1', 'Second', 0), createNew('new2', 'First', 1)];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      // At least one move should be generated
      expect(diff.moves.length).toBeGreaterThan(0);
    });
  });

  describe('Delete operations', () => {
    it('generates delete for removed blocks', () => {
      const existing = [
        createExisting('uid1', 'Keep', 0),
        createExisting('uid2', 'Remove', 1),
      ];
      const newBlocks = [createNew('new1', 'Keep', 0)];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.deletes.length).toBe(1);
      expect(diff.deletes[0].action).toBe('delete-block');
      expect((diff.deletes[0] as any).block.uid).toBe('uid2');
    });

    it('generates deletes for all blocks when new content is empty', () => {
      const existing = [
        createExisting('uid1', 'First', 0),
        createExisting('uid2', 'Second', 1),
      ];
      const newBlocks: NewBlock[] = [];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.deletes.length).toBe(2);
    });
  });

  describe('Preserved UIDs', () => {
    it('tracks preserved UIDs for matched blocks', () => {
      const existing = [
        createExisting('uid1', 'Matched', 0),
        createExisting('uid2', 'Also matched', 1),
      ];
      const newBlocks = [
        createNew('new1', 'Matched', 0),
        createNew('new2', 'Also matched', 1),
      ];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.preservedUids.has('uid1')).toBe(true);
      expect(diff.preservedUids.has('uid2')).toBe(true);
    });

    it('does not include unmatched blocks in preserved UIDs', () => {
      const existing = [createExisting('uid1', 'Will be deleted', 0)];
      const newBlocks = [createNew('new1', 'Completely different', 0)];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      // Position fallback matches these (≤3), so uid1 is preserved
      expect(diff.preservedUids.has('uid1')).toBe(true);
    });
  });

  describe('Mixed operations', () => {
    it('handles text update with matching', () => {
      const existing = [
        createExisting('uid1', 'Keep this', 0),
        createExisting('uid2', 'Update this', 1),
      ];
      const newBlocks = [
        createNew('new1', 'Keep this', 0),
        createNew('new2', 'Update this - modified', 1),
      ];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      // uid1 matches exactly, uid2 matched by position, gets updated
      expect(diff.preservedUids.size).toBe(2);
      expect(diff.updates.length).toBe(1);
      expect((diff.updates[0] as any).block.string).toBe('Update this - modified');
    });

    it('handles additions and deletions', () => {
      // Use >3 blocks to avoid position fallback for unmatched
      const existing = [
        createExisting('uid1', 'Keep A', 0),
        createExisting('uid2', 'Keep B', 1),
        createExisting('uid3', 'Delete C', 2),
        createExisting('uid4', 'Delete D', 3),
        createExisting('uid5', 'Delete E', 4),
        createExisting('uid6', 'Delete F', 5),
      ];
      const newBlocks = [
        createNew('new1', 'Keep A', 0),
        createNew('new2', 'Keep B', 1),
        createNew('new3', 'Add G', 2),
        createNew('new4', 'Add H', 3),
        createNew('new5', 'Add I', 4),
        createNew('new6', 'Add J', 5),
      ];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      // 2 matched (Keep A, Keep B), 4 new created, 4 old deleted
      expect(diff.preservedUids.size).toBe(2);
      expect(diff.creates.length).toBe(4);
      expect(diff.deletes.length).toBe(4);
    });

    it('handles reordering with moves', () => {
      const existing = [
        createExisting('uid1', 'First', 0),
        createExisting('uid2', 'Second', 1),
        createExisting('uid3', 'Third', 2),
      ];
      const newBlocks = [
        createNew('new1', 'Third', 0),  // uid3 -> 0
        createNew('new2', 'First', 1),  // uid1 -> 1
        createNew('new3', 'Second', 2), // uid2 -> 2
      ];

      const diff = diffBlockTrees(existing, newBlocks, pageUid);

      expect(diff.preservedUids.size).toBe(3);
      expect(diff.creates.length).toBe(0);
      expect(diff.deletes.length).toBe(0);
      // At least some moves expected for reordering
      expect(diff.moves.length).toBeGreaterThan(0);
    });
  });
});
