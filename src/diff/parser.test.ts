import { describe, it, expect } from 'vitest';
import {
  parseExistingBlock,
  parseExistingBlocks,
  flattenExistingBlocks,
  markdownToBlocks,
  getBlockDepth,
} from './parser.js';
import type { RoamApiBlock } from './types.js';

describe('parseExistingBlock', () => {
  it('parses a simple block', () => {
    const roamBlock: RoamApiBlock = {
      ':block/uid': 'abc123def',
      ':block/string': 'Hello world',
      ':block/order': 0,
      ':block/heading': null,
    };

    const block = parseExistingBlock(roamBlock);

    expect(block.uid).toBe('abc123def');
    expect(block.text).toBe('Hello world');
    expect(block.order).toBe(0);
    expect(block.heading).toBeNull();
    expect(block.children).toEqual([]);
    expect(block.parentUid).toBeNull();
  });

  it('parses block with heading', () => {
    const roamBlock: RoamApiBlock = {
      ':block/uid': 'heading1',
      ':block/string': 'Title',
      ':block/order': 0,
      ':block/heading': 2,
    };

    const block = parseExistingBlock(roamBlock);

    expect(block.heading).toBe(2);
  });

  it('parses nested children', () => {
    const roamBlock: RoamApiBlock = {
      ':block/uid': 'parent',
      ':block/string': 'Parent',
      ':block/order': 0,
      ':block/children': [
        {
          ':block/uid': 'child1',
          ':block/string': 'Child 1',
          ':block/order': 0,
        },
        {
          ':block/uid': 'child2',
          ':block/string': 'Child 2',
          ':block/order': 1,
        },
      ],
    };

    const block = parseExistingBlock(roamBlock);

    expect(block.children.length).toBe(2);
    expect(block.children[0].uid).toBe('child1');
    expect(block.children[0].parentUid).toBe('parent');
    expect(block.children[1].uid).toBe('child2');
    expect(block.children[1].parentUid).toBe('parent');
  });

  it('sorts children by order', () => {
    const roamBlock: RoamApiBlock = {
      ':block/uid': 'parent',
      ':block/string': 'Parent',
      ':block/order': 0,
      ':block/children': [
        { ':block/uid': 'c', ':block/string': 'C', ':block/order': 2 },
        { ':block/uid': 'a', ':block/string': 'A', ':block/order': 0 },
        { ':block/uid': 'b', ':block/string': 'B', ':block/order': 1 },
      ],
    };

    const block = parseExistingBlock(roamBlock);

    expect(block.children.map((c) => c.uid)).toEqual(['a', 'b', 'c']);
  });

  it('handles missing properties gracefully', () => {
    const roamBlock: RoamApiBlock = {};

    const block = parseExistingBlock(roamBlock);

    expect(block.uid).toBe('');
    expect(block.text).toBe('');
    expect(block.order).toBe(0);
    expect(block.heading).toBeNull();
  });
});

describe('parseExistingBlocks', () => {
  it('parses page children into blocks', () => {
    const pageData: RoamApiBlock = {
      ':block/uid': 'page123',
      ':block/children': [
        { ':block/uid': 'b1', ':block/string': 'First', ':block/order': 0 },
        { ':block/uid': 'b2', ':block/string': 'Second', ':block/order': 1 },
      ],
    };

    const blocks = parseExistingBlocks(pageData);

    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toBe('First');
    expect(blocks[1].text).toBe('Second');
    expect(blocks[0].parentUid).toBeNull();
  });

  it('returns empty array for page with no children', () => {
    const pageData: RoamApiBlock = { ':block/uid': 'page123' };

    const blocks = parseExistingBlocks(pageData);

    expect(blocks).toEqual([]);
  });
});

describe('flattenExistingBlocks', () => {
  it('flattens nested blocks into array', () => {
    const blocks = [
      {
        uid: 'a',
        text: 'A',
        order: 0,
        heading: null,
        parentUid: null,
        children: [
          {
            uid: 'a1',
            text: 'A1',
            order: 0,
            heading: null,
            parentUid: 'a',
            children: [],
          },
          {
            uid: 'a2',
            text: 'A2',
            order: 1,
            heading: null,
            parentUid: 'a',
            children: [],
          },
        ],
      },
      {
        uid: 'b',
        text: 'B',
        order: 1,
        heading: null,
        parentUid: null,
        children: [],
      },
    ];

    const flat = flattenExistingBlocks(blocks);

    expect(flat.map((b) => b.uid)).toEqual(['a', 'a1', 'a2', 'b']);
  });

  it('preserves depth-first order', () => {
    const blocks = [
      {
        uid: 'root',
        text: 'Root',
        order: 0,
        heading: null,
        parentUid: null,
        children: [
          {
            uid: 'child1',
            text: 'Child 1',
            order: 0,
            heading: null,
            parentUid: 'root',
            children: [
              {
                uid: 'grandchild',
                text: 'Grandchild',
                order: 0,
                heading: null,
                parentUid: 'child1',
                children: [],
              },
            ],
          },
          {
            uid: 'child2',
            text: 'Child 2',
            order: 1,
            heading: null,
            parentUid: 'root',
            children: [],
          },
        ],
      },
    ];

    const flat = flattenExistingBlocks(blocks);

    expect(flat.map((b) => b.uid)).toEqual([
      'root',
      'child1',
      'grandchild',
      'child2',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(flattenExistingBlocks([])).toEqual([]);
  });
});

describe('markdownToBlocks', () => {
  const pageUid = 'page123';

  it('converts simple markdown to blocks', () => {
    const markdown = `- First item
- Second item`;

    const blocks = markdownToBlocks(markdown, pageUid);

    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toBe('First item');
    expect(blocks[1].text).toBe('Second item');
    expect(blocks[0].parentRef?.blockUid).toBe(pageUid);
    expect(blocks[1].parentRef?.blockUid).toBe(pageUid);
  });

  it('handles nested markdown', () => {
    const markdown = `- Parent
  - Child`;

    const blocks = markdownToBlocks(markdown, pageUid);

    expect(blocks.length).toBe(2);
    const parentBlock = blocks.find((b) => b.text === 'Parent');
    const childBlock = blocks.find((b) => b.text === 'Child');

    expect(parentBlock).toBeDefined();
    expect(childBlock).toBeDefined();
    expect(childBlock?.parentRef?.blockUid).toBe(parentBlock?.ref.blockUid);
  });

  it('preserves heading levels', () => {
    const markdown = `# Heading 1
## Heading 2
### Heading 3`;

    const blocks = markdownToBlocks(markdown, pageUid);

    expect(blocks[0].heading).toBe(1);
    expect(blocks[1].heading).toBe(2);
    expect(blocks[2].heading).toBe(3);
  });

  it('generates unique UIDs', () => {
    const markdown = `- Item 1
- Item 2
- Item 3`;

    const blocks = markdownToBlocks(markdown, pageUid);
    const uids = blocks.map((b) => b.ref.blockUid);

    expect(new Set(uids).size).toBe(3); // All unique
  });

  it('sets order based on sibling position', () => {
    const markdown = `- First
- Second
- Third`;

    const blocks = markdownToBlocks(markdown, pageUid);

    expect(blocks[0].order).toBe(0);
    expect(blocks[1].order).toBe(1);
    expect(blocks[2].order).toBe(2);
  });
});

describe('getBlockDepth', () => {
  it('returns 0 for root blocks', () => {
    const blocks = [
      {
        ref: { blockUid: 'root' },
        text: 'Root',
        parentRef: { blockUid: 'page' },
        order: 0,
        open: true,
        heading: null,
      },
    ];

    expect(getBlockDepth(blocks[0], blocks)).toBe(0);
  });

  it('returns correct depth for nested blocks', () => {
    const blocks = [
      {
        ref: { blockUid: 'parent' },
        text: 'Parent',
        parentRef: { blockUid: 'page' },
        order: 0,
        open: true,
        heading: null,
      },
      {
        ref: { blockUid: 'child' },
        text: 'Child',
        parentRef: { blockUid: 'parent' },
        order: 0,
        open: true,
        heading: null,
      },
      {
        ref: { blockUid: 'grandchild' },
        text: 'Grandchild',
        parentRef: { blockUid: 'child' },
        order: 0,
        open: true,
        heading: null,
      },
    ];

    expect(getBlockDepth(blocks[1], blocks)).toBe(1);
    expect(getBlockDepth(blocks[2], blocks)).toBe(2);
  });
});
