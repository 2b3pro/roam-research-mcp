import { describe, it, expect } from 'vitest';
import { ednString } from './datalog.js';

describe('ednString', () => {
  it('wraps a plain value in quotes', () => {
    expect(ednString('Test Page')).toBe('"Test Page"');
  });

  it('escapes double quotes', () => {
    expect(ednString('Alex "Sandy" Pentland')).toBe('"Alex \\"Sandy\\" Pentland"');
  });

  it('escapes backslashes before quotes, so an escaped quote is not undone', () => {
    // A title ending in a backslash would otherwise escape the closing quote.
    expect(ednString('C:\\dir\\')).toBe('"C:\\\\dir\\\\"');
    expect(ednString('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it('leaves other characters alone, newlines included', () => {
    expect(ednString("it's [[linked]] #tag\nline two")).toBe('"it\'s [[linked]] #tag\nline two"');
  });
});
