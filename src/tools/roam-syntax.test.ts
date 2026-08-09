import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROAM_SYNTAX } from './roam-syntax.js';

/**
 * What must stay true of the blob no matter who rewrites the prose.
 *
 * Two failure modes are worth a test here. The first is DRIFT: the blob and
 * `Roam_Markdown_Cheatsheet.md` state overlapping facts, and a fix applied to
 * one leaves the other confidently wrong. The second is BLOAT: the blob rides
 * on every `roam_get_guidelines` response, and its whole justification is that
 * it is small enough never to be the reason an agent skips it. Prose grows;
 * this is the thing that notices.
 *
 * These assert on load-bearing content, not wording. A rewrite that keeps the
 * facts should pass.
 */

const CHEATSHEET = readFileSync('Roam_Markdown_Cheatsheet.md', 'utf-8');

describe('ROAM_SYNTAX size', () => {
  it('stays small enough to be worth attaching to every guidelines call', () => {
    // ~4 chars/token. The cap is a budget, not a measurement: the cheatsheet is
    // where detail belongs, and a blob that grows into a second cheatsheet has
    // lost the argument for being returned unconditionally.
    const approxTokens = ROAM_SYNTAX.length / 4;
    expect(approxTokens).toBeLessThan(900);
  });

  it('is a small fraction of the cheatsheet it does not replace', () => {
    expect(ROAM_SYNTAX.length).toBeLessThan(CHEATSHEET.length / 2);
  });
});

describe('ROAM_SYNTAX ordering', () => {
  const sections = ROAM_SYNTAX.split('\n').filter((line) => line.trim().length > 0);

  it('leads with the destructive rules', () => {
    // Primacy half of the damage-ranked ordering. Formatting and escaping
    // matter, but getting them wrong makes a mess; getting these wrong loses
    // work, so they cannot drift below the cosmetic sections.
    const firstDestructive = sections.findIndex((s) => s.startsWith('DESTRUCTIVE:'));
    const firstCosmetic = sections.findIndex((s) => s.startsWith('FORMATTING'));

    expect(firstDestructive).toBeGreaterThan(-1);
    expect(firstCosmetic).toBeGreaterThan(firstDestructive);
  });

  it('closes with the pre-write check', () => {
    expect(sections[sections.length - 1]).toMatch(/^BEFORE EVERY WRITE:/);
  });

  it('names all three destructive paths', () => {
    const destructive = sections.filter((s) => s.startsWith('DESTRUCTIVE:'));
    expect(destructive).toHaveLength(3);

    const joined = destructive.join(' ');
    expect(joined).toContain('roam_update_page_markdown'); // whole-page rewrites delete
    expect(joined).toContain('truncated'); // previews are not content
    expect(joined).toContain('((block-uid))'); // retyped refs go stale
  });

  it('does not file hidden subtrees as destructive', () => {
    // They were, until the diff baseline was fixed to exclude them. A warning
    // that outlives its hazard teaches an agent to discount the section it
    // sits in, so the hide-tag caution is now a correctness note, not a
    // destruction one — and it must not drift back.
    const hidden = sections.find((s) => s.includes('#.rm-hide'));
    expect(hidden).toBeDefined();
    expect(hidden!.startsWith('DESTRUCTIVE:')).toBe(false);
    expect(hidden).toMatch(/preserved_hidden/);
  });
});

describe('ROAM_SYNTAX agrees with the cheatsheet', () => {
  it('states the same italics/bold inversion', () => {
    // The single most-repeated Roam markdown error, and the one where the two
    // documents disagreeing would be worse than either being silent.
    expect(ROAM_SYNTAX).toContain('__text__');
    expect(ROAM_SYNTAX).toContain('**text**');
    expect(CHEATSHEET).toContain('`**bold**` · `__italic__`');
  });

  it('states the same TODO form', () => {
    expect(ROAM_SYNTAX).toContain('{{[[TODO]]}}');
    expect(CHEATSHEET).toContain('{{[[TODO]]}}');
  });

  it('gives the same warning about bare #N minting a page', () => {
    expect(ROAM_SYNTAX).toMatch(/`#1`/);
    expect(CHEATSHEET).toMatch(/`#1`/);
  });

  it('uses the same ordinal date example format the helpers produce', () => {
    expect(ROAM_SYNTAX).toMatch(/\[\[[A-Z][a-z]+ \d{1,2}(st|nd|rd|th), \d{4}\]\]/);
  });

  it('does not contradict the cheatsheet on attribute bolding', () => {
    expect(ROAM_SYNTAX).toContain('**Type**::');
    expect(CHEATSHEET).toContain('**Attr**::');
  });
});

describe('ROAM_SYNTAX escaping', () => {
  it('backticks its own examples, since this text can be pasted into a graph', () => {
    // The blob tells agents to backtick documented syntax. A blob that violates
    // its own rule is one paste away from minting the pages it warns about.
    const unbackticked = ROAM_SYNTAX
      // Drop everything already inside backticks, then look for live markup.
      .replace(/`[^`]*`/g, '')
      .match(/\[\[[^\]]+\]\]|\{\{[^}]+\}\}|\(\([^)]+\)\)/g);

    expect(unbackticked ?? []).toEqual([]);
  });
});
