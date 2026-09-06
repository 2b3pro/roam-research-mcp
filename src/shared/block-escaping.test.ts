import { describe, it, expect } from 'vitest';
import {
  escapeBlockString,
  unescapeBlockString,
  needsNewlineEscaping,
  ESCAPED_NEWLINES_MARKER,
  SOFT_BREAK_SENTINEL,
} from './block-escaping.js';

describe('the sentinel encoding', () => {
  it('renders a newline as the sentinel', () => {
    expect(escapeBlockString('one\ntwo')).toBe('one⏎two');
  });

  it('restores a newline from the sentinel', () => {
    expect(unescapeBlockString('one⏎two')).toBe('one\ntwo');
  });

  it('has no backslash rules at all', () => {
    // The Revision 2 design escaped backslashes and decoded `\n`, which
    // corrupted every LaTeX command and Windows path beginning `\n`. Deleted.
    for (const s of ['$$\\nabla f$$', 'C:\\newdir', 'a \\neq b', '\\\\', 'ends with \\']) {
      expect(escapeBlockString(s)).toBe(s);
      expect(unescapeBlockString(s)).toBe(s);
    }
  });

  it('is the identity on newline-free text', () => {
    expect(escapeBlockString('plain [[Page]] text')).toBe('plain [[Page]] text');
  });
});

describe('round trip', () => {
  const CASES = [
    '',
    'plain',
    'one\ntwo',
    '$$\\nabla f$$ and C:\\newdir on\ntwo lines',
    '```javascript\nconst x = 1;\n```',
    '[[>]] [[!TIP]] Title\nBody',
    'trailing backslash \\',
    '\n',
  ];

  it.each(CASES)('survives: %j', (input) => {
    expect(unescapeBlockString(escapeBlockString(input))).toBe(input);
  });

  it('documents the corner: a literal sentinel round-trips to a newline', () => {
    // Chosen, not accidental: a block genuinely containing ⏎ is vanishingly
    // rare, and the damage is a soft break inside one block — content-level,
    // never structural. Compare Revision 2, where the colliding character
    // was `\`, which LaTeX generates systematically.
    expect(unescapeBlockString(escapeBlockString('literal ⏎ here'))).toBe('literal \n here');
  });

  it('survives fuzzing over newline-heavy strings', () => {
    let seed = 0x2b3f00d;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const ALPHABET = ['\n', 'a', ' ', '\\', 'n', '`', '[[', '$', 'x'];
    for (let i = 0; i < 5000; i++) {
      const len = Math.floor(rand() * 12);
      let s = '';
      for (let j = 0; j < len; j++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
      expect(unescapeBlockString(escapeBlockString(s)), `input ${JSON.stringify(s)}`).toBe(s);
    }
  });
});

describe('needsNewlineEscaping and the marker (unchanged from R2)', () => {
  it('is true only when some block holds a newline', () => {
    expect(needsNewlineEscaping(['plain', 'C:\\newdir'])).toBe(false);
    expect(needsNewlineEscaping(['plain', 'one\ntwo'])).toBe(true);
    expect(needsNewlineEscaping([])).toBe(false);
  });

  it('keeps the marker an inert HTML comment', () => {
    expect(ESCAPED_NEWLINES_MARKER).toBe('<!-- roam:escaped-newlines -->');
  });

  it('exports the sentinel for callers that must reference it', () => {
    expect(SOFT_BREAK_SENTINEL).toBe('⏎');
  });
});
