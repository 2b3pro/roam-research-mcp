import { describe, it, expect } from 'vitest';
import { parseMarkdown, convertToRoamActions, convertToRoamActionsWithBlocks, nestUnderHeadings, convertToRoamMarkdown, type MarkdownNode } from './markdown-utils.js';

describe('markdown-utils', () => {
  describe('parseMarkdown - numbered lists', () => {
    it('should detect numbered list items and strip prefixes', () => {
      const markdown = `1. First item
2. Second item
3. Third item`;

      const nodes = parseMarkdown(markdown);

      expect(nodes).toHaveLength(3);
      expect(nodes[0].content).toBe('First item');
      expect(nodes[1].content).toBe('Second item');
      expect(nodes[2].content).toBe('Third item');
      // Root-level numbered items don't get children_view_type (no parent)
      expect(nodes[0].children_view_type).toBeUndefined();
    });

    it('should set children_view_type: numbered on parent of numbered items', () => {
      const markdown = `Parent block
  1. First numbered
  2. Second numbered`;

      const nodes = parseMarkdown(markdown);

      expect(nodes).toHaveLength(1);
      expect(nodes[0].content).toBe('Parent block');
      expect(nodes[0].children_view_type).toBe('numbered');
      expect(nodes[0].children).toHaveLength(2);
      expect(nodes[0].children[0].content).toBe('First numbered');
      expect(nodes[0].children[1].content).toBe('Second numbered');
    });

    it('should handle nested numbered lists', () => {
      const markdown = `- Parent
  1. First
  2. Second
    1. Nested first
    2. Nested second`;

      const nodes = parseMarkdown(markdown);

      expect(nodes).toHaveLength(1);
      expect(nodes[0].content).toBe('Parent');
      expect(nodes[0].children_view_type).toBe('numbered');
      expect(nodes[0].children).toHaveLength(2);
      expect(nodes[0].children[1].children_view_type).toBe('numbered');
      expect(nodes[0].children[1].children).toHaveLength(2);
    });

    it('should handle mixed bullet and numbered lists', () => {
      const markdown = `- Bullet item
1. Numbered item
- Another bullet`;

      const nodes = parseMarkdown(markdown);

      expect(nodes).toHaveLength(3);
      expect(nodes[0].content).toBe('Bullet item');
      expect(nodes[1].content).toBe('Numbered item');
      expect(nodes[2].content).toBe('Another bullet');
    });

    it('should handle double-digit numbers', () => {
      const markdown = `10. Tenth item
11. Eleventh item
99. Ninety-ninth item`;

      const nodes = parseMarkdown(markdown);

      expect(nodes).toHaveLength(3);
      expect(nodes[0].content).toBe('Tenth item');
      expect(nodes[1].content).toBe('Eleventh item');
      expect(nodes[2].content).toBe('Ninety-ninth item');
    });
  });

  describe('parseMarkdown - horizontal rules', () => {
    it('should convert --- to Roam HR', () => {
      const markdown = `Before
---
After`;

      const nodes = parseMarkdown(markdown);

      expect(nodes).toHaveLength(3);
      expect(nodes[0].content).toBe('Before');
      expect(nodes[1].content).toBe('---');
      expect(nodes[1].is_hr).toBe(true);
      expect(nodes[2].content).toBe('After');
    });

    it('should convert *** to Roam HR', () => {
      const markdown = `Before
***
After`;

      const nodes = parseMarkdown(markdown);

      expect(nodes).toHaveLength(3);
      expect(nodes[1].content).toBe('---');
      expect(nodes[1].is_hr).toBe(true);
    });

    it('should convert ___ to Roam HR', () => {
      const markdown = `Before
___
After`;

      const nodes = parseMarkdown(markdown);

      expect(nodes).toHaveLength(3);
      expect(nodes[1].content).toBe('---');
      expect(nodes[1].is_hr).toBe(true);
    });

    it('should handle longer HR variants', () => {
      const markdown = `-----
*****
_______`;

      const nodes = parseMarkdown(markdown);

      expect(nodes).toHaveLength(3);
      expect(nodes[0].content).toBe('---');
      expect(nodes[1].content).toBe('---');
      expect(nodes[2].content).toBe('---');
    });

    it('should not convert inline dashes', () => {
      const markdown = `This has -- some dashes
And this--too`;

      const nodes = parseMarkdown(markdown);

      expect(nodes).toHaveLength(2);
      expect(nodes[0].is_hr).toBeUndefined();
      expect(nodes[1].is_hr).toBeUndefined();
    });
  });

  describe('convertToRoamActions - numbered lists', () => {
    it('should include children-view-type in block action', () => {
      const markdown = `Parent
  1. First
  2. Second`;

      const nodes = parseMarkdown(markdown);
      const actions = convertToRoamActions(nodes, 'test-page-uid');

      // First action is the parent block
      const parentAction = actions[0] as any;
      expect(parentAction.block['children-view-type']).toBe('numbered');
    });
  });

  describe('convertToRoamActionsWithBlocks', () => {
    it('returns a minted block tree whose UIDs match the create-block actions, across 3 nested levels', () => {
      const markdown = `- Level 1 — Alpha
  - Level 2 — Alpha.1
    - Level 3 — Alpha.1.a
    - Level 3 — Alpha.1.b
  - Level 2 — Alpha.2
    - Level 3 — Alpha.2.a
- Level 1 — Beta
  - Level 2 — Beta.1
    - Level 3 — Beta.1.a`;

      const nodes = parseMarkdown(markdown);
      const { actions, blocks } = convertToRoamActionsWithBlocks(nodes, 'PARENT123', 'last');

      // 9 source bullets → more than the old VERIFICATION_THRESHOLD of 5
      expect(actions.length).toBe(9);

      // Collect every UID from the returned block tree
      const treeUids = new Set<string>();
      const walk = (bs: typeof blocks) => bs.forEach(b => { treeUids.add(b.uid); walk(b.children); });
      walk(blocks);

      // The tree UIDs must be exactly the action UIDs (no re-query, same minted ids)
      const actionUids = actions.map(a => (a as any).block.uid as string);
      expect(treeUids.size).toBe(actions.length);
      actionUids.forEach(uid => expect(treeUids.has(uid)).toBe(true));

      // Nesting is preserved end-to-end
      expect(blocks).toHaveLength(2);
      expect(blocks[0].content).toBe('Level 1 — Alpha');
      expect(blocks[0].children).toHaveLength(2);          // Alpha.1, Alpha.2
      expect(blocks[0].children[0].children).toHaveLength(2); // Alpha.1.a, Alpha.1.b
      expect(blocks[1].children[0].children).toHaveLength(1); // Beta.1.a
    });
  });

  describe('convertToRoamMarkdown - italic vs literal underscores', () => {
    it('still converts genuine word-boundary italics to Roam __italic__', () => {
      expect(convertToRoamMarkdown('this is _italic_ text')).toBe('this is __italic__ text');
      expect(convertToRoamMarkdown('_leading_ and *starred*')).toBe('__leading__ and __starred__');
    });

    it('leaves intra-word (snake_case) underscores literal', () => {
      const line = 'Source transcript on disk :: american_alchemy_dave_rossi.txt';
      expect(convertToRoamMarkdown(line)).toBe(line);
    });

    it('leaves underscores inside URLs literal', () => {
      const line = 'Ning Li: https://en.wikipedia.org/wiki/Ning_Li_(physicist)';
      expect(convertToRoamMarkdown(line)).toBe(line);
    });

    it('does not treat word_bounded_ trailing underscores as emphasis', () => {
      expect(convertToRoamMarkdown('foo_bar_baz')).toBe('foo_bar_baz');
    });

    it('keeps underscores literal when wrapped in inline code (backtick escape hatch)', () => {
      const line = 'literal `_not_italic_` here';
      expect(convertToRoamMarkdown(line)).toBe(line);
    });
  });

  describe('nestUnderHeadings', () => {
    const node = (content: string, heading_level = 0, children: MarkdownNode[] = []): MarkdownNode =>
      ({ content, level: 1, heading_level, children });

    it('nests content and deeper headings under their section heading', () => {
      const flat: MarkdownNode[] = [
        node('Section A', 2),
        node('Body of A'),
        node('Sub A1', 3),
        node('Body of A1'),
        node('Section B', 2),
        node('Body of B'),
      ];

      const nested = nestUnderHeadings(flat);

      // Two H2 sections at root
      expect(nested).toHaveLength(2);
      expect(nested[0].content).toBe('Section A');
      // Section A absorbs its body AND the deeper H3 section
      expect(nested[0].children.map(c => c.content)).toEqual(['Body of A', 'Sub A1']);
      const subA1 = nested[0].children[1];
      expect(subA1.heading_level).toBe(3);
      expect(subA1.children.map(c => c.content)).toEqual(['Body of A1']);
      expect(nested[1].content).toBe('Section B');
      expect(nested[1].children.map(c => c.content)).toEqual(['Body of B']);
    });

    it('keeps content before the first heading at root', () => {
      const flat: MarkdownNode[] = [
        node('Date:: [[May 30th, 2026]]'),
        node('Section A', 2),
        node('Body'),
      ];

      const nested = nestUnderHeadings(flat);

      expect(nested.map(c => c.content)).toEqual(['Date:: [[May 30th, 2026]]', 'Section A']);
      expect(nested[1].children.map(c => c.content)).toEqual(['Body']);
    });

    it('treats same-level headings as siblings, deeper levels as nested', () => {
      const flat: MarkdownNode[] = [
        node('H2 first', 2),
        node('H2 second', 2),
      ];

      const nested = nestUnderHeadings(flat);

      expect(nested.map(c => c.content)).toEqual(['H2 first', 'H2 second']);
      expect(nested[0].children).toHaveLength(0);
    });

    it('leaves heading-free indented structure unchanged (backward compatible)', () => {
      const original: MarkdownNode[] = [
        node('Parent', 0, [ node('Child', 0, [ node('Grandchild') ]) ]),
      ];

      const nested = nestUnderHeadings(original);

      expect(nested).toHaveLength(1);
      expect(nested[0].content).toBe('Parent');
      expect(nested[0].children).toHaveLength(1);
      expect(nested[0].children[0].children.map(c => c.content)).toEqual(['Grandchild']);
    });

    it('end-to-end: flush-left heading markdown parses + nests into a section tree (reproduces the pilot-page bug input)', () => {
      const markdown = [
        '## TL;DR',
        'continue InjectionGate',
        '## Telemetry rollup',
        '### Day-by-day',
        '2026-05-25 — 293 calls',
        '### By caller',
        'AutoWorkCreation',
        '## Recommendation',
        'continue all',
      ].join('\n');

      const nested = nestUnderHeadings(parseMarkdown(markdown));

      // Top level is exactly the three H2 sections — not nine flat siblings
      expect(nested.map(n => n.content)).toEqual(['TL;DR', 'Telemetry rollup', 'Recommendation']);
      expect(nested.every(n => n.heading_level === 2)).toBe(true);

      // TL;DR holds its body line
      expect(nested[0].children.map(c => c.content)).toEqual(['continue InjectionGate']);

      // Telemetry holds two H3 subsections, each nesting its own body line
      const telemetry = nested[1];
      expect(telemetry.children.map(c => c.content)).toEqual(['Day-by-day', 'By caller']);
      expect(telemetry.children[0].children.map(c => c.content)).toEqual(['2026-05-25 — 293 calls']);
      expect(telemetry.children[1].children.map(c => c.content)).toEqual(['AutoWorkCreation']);

      // Recommendation holds its body
      expect(nested[2].children.map(c => c.content)).toEqual(['continue all']);
    });
  });
});
