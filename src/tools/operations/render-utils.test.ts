import { describe, it, expect } from 'vitest';
import { renderBlocks, renderMarkdown } from './render-utils.js';
import type { LinkedReferenceGroup } from './render-utils.js';
import type { RoamBlock } from '../types/index.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function block(string: string, children: RoamBlock[] = [], heading?: number): RoamBlock {
  return { uid: 'uid', string, order: 0, heading: heading ?? null, children };
}

// ─── renderBlocks ─────────────────────────────────────────────────────────────

describe('renderBlocks', () => {
  it('renders a single flat block as a bullet', () => {
    expect(renderBlocks([block('Hello')], 0)).toBe('- Hello');
  });

  it('renders heading blocks with hashes', () => {
    expect(renderBlocks([block('Title', [], 1)], 0)).toBe('# Title');
    expect(renderBlocks([block('Sub', [], 2)], 0)).toBe('## Sub');
  });

  it('renders nested children with indentation', () => {
    const parent = block('Parent', [block('Child', [block('Grandchild')])]);
    const result = renderBlocks([parent], 0);
    expect(result).toBe('- Parent\n  - Child\n    - Grandchild');
  });

  it('respects baseIndent offset', () => {
    expect(renderBlocks([block('Item')], 2)).toBe('    - Item');
  });

  it('renders multiple sibling blocks', () => {
    const blocks = [block('A'), block('B'), block('C')];
    expect(renderBlocks(blocks, 0)).toBe('- A\n- B\n- C');
  });

  it('renders empty block list as empty string', () => {
    expect(renderBlocks([], 0)).toBe('');
  });

  it('treats heading=0 as a regular bullet', () => {
    expect(renderBlocks([block('Zero', [], 0)], 0)).toBe('- Zero');
  });
});

// ─── renderMarkdown ───────────────────────────────────────────────────────────

describe('renderMarkdown', () => {
  it('renders a page header', () => {
    const result = renderMarkdown('My Page', [], []);
    expect(result).toContain('# My Page');
  });

  it('shows (no content) for empty page blocks', () => {
    const result = renderMarkdown('Empty Page', [], []);
    expect(result).toContain('*(no content)*');
  });

  it('renders page blocks when present', () => {
    const result = renderMarkdown('Page', [block('Some note')], []);
    expect(result).toContain('- Some note');
  });

  it('shows zero linked references correctly', () => {
    const result = renderMarkdown('Page', [], []);
    expect(result).toContain('## Linked References (0 references from 0 pages)');
    expect(result).toContain('*(no linked references)*');
  });

  it('uses singular "reference" and "page" for counts of 1', () => {
    const group: LinkedReferenceGroup = {
      source_page_title: 'Source',
      source_page_uid: 'src1',
      references: [{
        breadcrumbs: [],
        block: block('Referring block')
      }]
    };
    const result = renderMarkdown('Page', [], [group]);
    expect(result).toContain('1 reference');
    expect(result).toContain('1 page');
    expect(result).not.toContain('1 references');
    expect(result).not.toContain('1 pages');
  });

  it('renders source page title with [[ ]] in linked references', () => {
    const group: LinkedReferenceGroup = {
      source_page_title: 'Daily Notes',
      source_page_uid: 'dn1',
      references: [{ breadcrumbs: [], block: block('Some ref') }]
    };
    const result = renderMarkdown('Page', [], [group]);
    expect(result).toContain('### [[Daily Notes]]');
  });

  it('renders breadcrumbs as nested blockquotes', () => {
    const group: LinkedReferenceGroup = {
      source_page_title: 'Source',
      source_page_uid: 'src1',
      references: [{
        breadcrumbs: [
          { uid: 'p1', string: 'Level 1' },
          { uid: 'p2', string: 'Level 2' }
        ],
        block: block('The ref')
      }]
    };
    const result = renderMarkdown('Page', [], [group]);
    expect(result).toContain('> Level 1');
    expect(result).toContain('> > Level 2');
    // block indented by 2 levels
    expect(result).toContain('    - The ref');
  });

  it('renders children of a referring block', () => {
    const group: LinkedReferenceGroup = {
      source_page_title: 'Source',
      source_page_uid: 'src1',
      references: [{
        breadcrumbs: [],
        block: block('Parent ref', [block('Child of ref')])
      }]
    };
    const result = renderMarkdown('Page', [], [group]);
    expect(result).toContain('- Parent ref');
    expect(result).toContain('  - Child of ref');
  });

  it('shows truncation note when totalAvailable is provided', () => {
    const group: LinkedReferenceGroup = {
      source_page_title: 'Source',
      source_page_uid: 'src1',
      references: [{ breadcrumbs: [], block: block('ref') }]
    };
    const result = renderMarkdown('Page', [], [group], 500);
    expect(result).toContain('capped at 1 of 500');
    expect(result).toContain('use max_references to increase');
  });

  it('omits truncation note when totalAvailable is undefined', () => {
    const result = renderMarkdown('Page', [], []);
    expect(result).not.toContain('capped at');
  });

  it('renders references from multiple pages with --- separators', () => {
    const groups: LinkedReferenceGroup[] = [
      { source_page_title: 'Page A', source_page_uid: 'a', references: [{ breadcrumbs: [], block: block('ref A') }] },
      { source_page_title: 'Page B', source_page_uid: 'b', references: [{ breadcrumbs: [], block: block('ref B') }] }
    ];
    const result = renderMarkdown('Page', [], groups);
    expect(result).toContain('[[Page A]]');
    expect(result).toContain('[[Page B]]');
    expect(result).toContain('2 references from 2 pages');
  });
});
