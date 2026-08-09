import { describe, it, expect } from 'vitest';
import { escapeBlockString, unescapeBlockString } from './block-escaping.js';

describe('escapeBlockString', () => {
  it('leaves ordinary text untouched', () => {
    expect(escapeBlockString('A plain block')).toBe('A plain block');
  });

  it('turns a real newline into the two characters backslash-n', () => {
    expect(escapeBlockString('one\ntwo')).toBe('one\\ntwo');
  });

  it('escapes the escape character first, so a literal survives', () => {
    // Order matters: newline-first would produce `a\nb` for BOTH inputs,
    // making them indistinguishable on the way back.
    expect(escapeBlockString('a\\nb')).toBe('a\\\\nb');
    expect(escapeBlockString('a\nb')).toBe('a\\nb');
  });
});

describe('unescapeBlockString', () => {
  it('leaves ordinary text untouched', () => {
    expect(unescapeBlockString('A plain block')).toBe('A plain block');
  });

  it('restores a newline', () => {
    expect(unescapeBlockString('one\\ntwo')).toBe('one\ntwo');
  });

  it('does not re-examine its own output', () => {
    // The naive two-pass regex turns this into a real newline. It must not.
    expect(unescapeBlockString('a\\\\nb')).toBe('a\\nb');
  });

  it('keeps a trailing lone backslash', () => {
    // The end-of-string boundary: there is no successor to consume.
    expect(unescapeBlockString('ends with\\')).toBe('ends with\\');
  });

  it('leaves an unrecognised escape alone', () => {
    expect(unescapeBlockString('a\\tb')).toBe('a\\tb');
  });
});

describe('round trip', () => {
  const CASES = [
    '',
    'plain',
    'one\ntwo',
    'a\\nb',
    'console.log("a\\nb");',
    '```javascript\nconst x = 1;\n```',
    '[[>]] [[!TIP]] Title\nBody',
    'trailing backslash \\',
    '\\\\',
    '\n',
    '\\',
    'mixed \\ and \n and \\n together',
  ];

  it.each(CASES)('survives: %j', (input) => {
    expect(unescapeBlockString(escapeBlockString(input))).toBe(input);
  });

  it('survives fuzzing biased toward backslashes and newlines', () => {
    // A deterministic PRNG: the suite must fail reproducibly, and
    // Math.random would make a failure impossible to re-run.
    let seed = 0x2b3f00d;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const ALPHABET = ['\\', '\n', 'n', 'a', ' ', '`', '\\n', '\\\\', '[[', 'x'];

    for (let i = 0; i < 5000; i++) {
      const len = Math.floor(rand() * 12);
      let s = '';
      for (let j = 0; j < len; j++) {
        s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
      }
      expect(unescapeBlockString(escapeBlockString(s)), `input ${JSON.stringify(s)}`).toBe(s);
    }
  });
});
