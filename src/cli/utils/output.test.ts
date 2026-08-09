import { describe, it, expect } from 'vitest';
import { formatPageOutput } from './output.js';
import type { RoamBlock } from '../../tools/types/index.js';

const block = (uid: string, string: string, children: RoamBlock[] = []): RoamBlock =>
  ({ uid, string, order: 0, children } as RoamBlock);

describe('CLI markdown output', () => {
  it('marks and escapes a page holding a soft line break', () => {
    // `roam get > file; roam save file --update` is a documented workflow, so
    // this renderer feeds the same parser the MCP tool does.
    const out = formatPageOutput('P', [block('a', 'one\ntwo')], {} as any);
    expect(out).toContain('<!-- roam:escaped-newlines -->');
    expect(out).toContain('one\\ntwo');
    expect(out).not.toMatch(/^two/m);
  });

  it('leaves an ordinary page untouched', () => {
    const out = formatPageOutput('P', [block('a', 'C:\\newdir')], {} as any);
    expect(out).not.toContain('<!-- roam:escaped-newlines -->');
    expect(out).toContain('C:\\newdir');
  });
});
