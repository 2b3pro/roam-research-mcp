import type { RoamBlock } from '../types/index.js';

export interface Breadcrumb {
  uid: string;
  string: string;
}

export interface ReferenceWithContext {
  breadcrumbs: Breadcrumb[];
  block: RoamBlock;
}

export interface LinkedReferenceGroup {
  source_page_title: string;
  source_page_uid: string;
  references: ReferenceWithContext[];
}

export function renderBlocks(blocks: RoamBlock[], baseIndent: number): string {
  const renderBlock = (block: RoamBlock, depth: number): string => {
    const indent = '  '.repeat(depth);
    let line: string;
    if (block.heading && block.heading > 0) {
      const hashes = '#'.repeat(block.heading);
      line = `${indent}${hashes} ${block.string}`;
    } else {
      line = `${indent}- ${block.string}`;
    }
    const childLines = block.children.map(c => renderBlock(c, depth + 1)).join('\n');
    return childLines ? `${line}\n${childLines}` : line;
  };
  return blocks.map(b => renderBlock(b, baseIndent)).join('\n');
}

export function renderMarkdown(
  title: string,
  pageBlocks: RoamBlock[],
  linkedRefs: LinkedReferenceGroup[],
  totalAvailable?: number
): string {
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push('');
  if (pageBlocks.length > 0) {
    lines.push(renderBlocks(pageBlocks, 0));
  } else {
    lines.push('*(no content)*');
  }

  const totalRefs = linkedRefs.reduce((sum, g) => sum + g.references.length, 0);
  const truncationNote = totalAvailable !== undefined
    ? ` — *capped at ${totalRefs} of ${totalAvailable}; use max_references to increase*`
    : '';
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`## Linked References (${totalRefs} reference${totalRefs !== 1 ? 's' : ''} from ${linkedRefs.length} page${linkedRefs.length !== 1 ? 's' : ''}${truncationNote})`);

  if (totalRefs === 0) {
    lines.push('');
    lines.push('*(no linked references)*');
  } else {
    for (const group of linkedRefs) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push(`### [[${group.source_page_title}]]`);
      lines.push('');

      for (const ref of group.references) {
        for (let i = 0; i < ref.breadcrumbs.length; i++) {
          const prefix = '> '.repeat(i + 1);
          lines.push(`${prefix}${ref.breadcrumbs[i].string}`);
        }

        const refIndent = '  '.repeat(ref.breadcrumbs.length);
        lines.push(`${refIndent}- ${ref.block.string}`);

        if (ref.block.children.length > 0) {
          lines.push(renderBlocks(ref.block.children, ref.breadcrumbs.length + 1));
        }

        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
