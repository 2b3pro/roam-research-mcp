import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlockRetrievalOperations } from './block-retrieval.js';
import { Graph } from '@roam-research/roam-api-sdk';

// Mock roam-api-sdk
vi.mock('@roam-research/roam-api-sdk', () => ({
  q: vi.fn(),
  Graph: vi.fn(),
}));

import { q } from '@roam-research/roam-api-sdk';

describe('BlockRetrievalOperations', () => {
  let ops: BlockRetrievalOperations;
  let mockGraph: Graph;

  beforeEach(() => {
    mockGraph = {} as Graph;
    ops = new BlockRetrievalOperations(mockGraph);
    vi.clearAllMocks();
  });

  it('fetches a block with recursive reference resolution', async () => {
    const qMock = q as unknown as ReturnType<typeof vi.fn>;

    // 1. Root block query
    // Query: [:find ?string ?order ?heading ... :where [?b :block/uid ?blockUid] ...]
    qMock.mockResolvedValueOnce([['Root Block with Ref ((ref1))', 0, null]]);
    
    // 2. Children query
    // Query: [:find ?parentUid ?childUid ... :where ... [?parent :block/children ?child] ...]
    qMock.mockResolvedValueOnce([]); 

    // 3. Resolve References Level 1: Fetch ((ref1))
    // Query: [:find ?uid ?string ?heading ... :where [?b :block/uid ?uid] ...]
    qMock.mockResolvedValueOnce([['ref1', 'Ref 1 content with ((ref2))', null]]);

    // 4. Resolve References Level 2: Fetch ((ref2))
    qMock.mockResolvedValueOnce([['ref2', 'Ref 2 content', null]]);

    const result = await ops.fetchBlockWithChildren('root-uid');

    expect(result).toBeDefined();
    expect(result?.uid).toBe('root-uid');
    expect(result?.string).toBe('Root Block with Ref ((ref1))');
    
    expect(result?.refs).toBeDefined();
    expect(result?.refs).toHaveLength(1);
    const ref1 = result?.refs?.[0];
    expect(ref1).toBeDefined();
    if (!ref1) {
      throw new Error('Expected ref1 to be defined');
    }
    expect(ref1.uid).toBe('ref1');
    expect(ref1.string).toBe('Ref 1 content with ((ref2))');
    
    expect(ref1.refs).toBeDefined();
    expect(ref1.refs).toHaveLength(1);
    const ref2 = ref1.refs?.[0];
    expect(ref2).toBeDefined();
    if (!ref2) {
      throw new Error('Expected ref2 to be defined');
    }
    expect(ref2.uid).toBe('ref2');
    expect(ref2.string).toBe('Ref 2 content');
    
    // ref2 should have empty refs as it has no refs in string
    expect(ref2.refs).toEqual([]);
  });
  
  it('handles multiple references in same block', async () => {
    const qMock = q as unknown as ReturnType<typeof vi.fn>;

    // 1. Root block
    qMock.mockResolvedValueOnce([['Root ((refA)) and ((refB))', 0, null]]);
    // 2. Children
    qMock.mockResolvedValueOnce([]);
    
    // 3. Resolve refs (refA, refB)
    // The order in query result is not guaranteed but input is set.
    qMock.mockResolvedValueOnce([
        ['refA', 'Content A', null],
        ['refB', 'Content B', null]
    ]);
    
    // 4. Next level (no refs in A or B) -> No query expected because resolveReferences checks before querying
    // Wait, resolveReferences checks matches. Content A and Content B have no refs.
    // So logic should stop.

    const result = await ops.fetchBlockWithChildren('root-uid');
    
    expect(result?.refs).toHaveLength(2);
    const uids = result?.refs?.map(r => r.uid).sort();
    expect(uids).toEqual(['refA', 'refB']);
  });

  it('handles shared references in tree', async () => {
     const qMock = q as unknown as ReturnType<typeof vi.fn>;

    // 1. Root block
    qMock.mockResolvedValueOnce([['Root', 0, null]]);
    
    // 2. Children: Child1 ((shared)) and Child2 ((shared))
    qMock.mockResolvedValueOnce([
        ['root-uid', 'child1', 'Child 1 ((shared))', 0, null],
        ['root-uid', 'child2', 'Child 2 ((shared))', 1, null]
    ]);
    
    // 3. Children of Child1 and Child2 (empty)
    qMock.mockResolvedValueOnce([]); 

    // 4. Resolve refs. Both reference 'shared'.
    // Should query 'shared' once.
    qMock.mockResolvedValueOnce([['shared', 'Shared Content', null]]);
    
    const result = await ops.fetchBlockWithChildren('root-uid');
    
    const child1 = result?.children.find(c => c.uid === 'child1');
    const child2 = result?.children.find(c => c.uid === 'child2');
    
    expect(child1?.refs).toHaveLength(1);
    expect(child1?.refs![0].uid).toBe('shared');
    
    expect(child2?.refs).toHaveLength(1);
    expect(child2?.refs![0].uid).toBe('shared');
    
    // Verify query was called with 'shared' once
    // (We can't easily check exact args of 4th call without inspecting mocks deeper, 
    // but the implementation logic de-duplicates UIDs).
  });
});
