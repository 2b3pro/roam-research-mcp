import { describe, it, expect } from 'vitest';
import { sanitizeTagName } from './helpers.js';

describe('sanitizeTagName', () => {
  it('passes through bare tag names unchanged', () => {
    expect(sanitizeTagName('Type/Procedural')).toBe('Type/Procedural');
  });

  it('strips leading # from tags', () => {
    expect(sanitizeTagName('#Type/Procedural')).toBe('Type/Procedural');
  });

  it('strips multiple leading # characters', () => {
    expect(sanitizeTagName('##Domain/System')).toBe('Domain/System');
  });

  it('strips [[ ]] wrappers', () => {
    expect(sanitizeTagName('[[Multi Word Tag]]')).toBe('Multi Word Tag');
  });

  it('strips # and [[ ]] together', () => {
    expect(sanitizeTagName('#[[Priority/Core]]')).toBe('Priority/Core');
  });

  it('trims whitespace', () => {
    expect(sanitizeTagName('  #Tag  ')).toBe('Tag');
  });

  it('handles simple single-word tags', () => {
    expect(sanitizeTagName('Memories')).toBe('Memories');
    expect(sanitizeTagName('#Memories')).toBe('Memories');
  });
});
