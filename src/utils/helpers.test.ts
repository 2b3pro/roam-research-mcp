import { describe, it, expect } from 'vitest';
import { sanitizeTagName, normalizeToRoamDate, resolveRelativeDate, formatRoamDate } from './helpers.js';

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

describe('normalizeToRoamDate', () => {
  it('returns null for non-date strings', () => {
    expect(normalizeToRoamDate('My Page Title')).toBeNull();
    expect(normalizeToRoamDate('abc123def')).toBeNull();
    expect(normalizeToRoamDate('')).toBeNull();
    expect(normalizeToRoamDate('hello')).toBeNull();
  });

  it('passes through already-correct Roam dates', () => {
    expect(normalizeToRoamDate('March 21st, 2026')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('January 1st, 2024')).toBe('January 1st, 2024');
    expect(normalizeToRoamDate('December 25th, 2025')).toBe('December 25th, 2025');
    expect(normalizeToRoamDate('February 2nd, 2026')).toBe('February 2nd, 2026');
    expect(normalizeToRoamDate('March 3rd, 2026')).toBe('March 3rd, 2026');
  });

  it('normalizes ISO dates (YYYY-MM-DD)', () => {
    expect(normalizeToRoamDate('2026-03-21')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('2026-01-01')).toBe('January 1st, 2026');
    expect(normalizeToRoamDate('2025-12-25')).toBe('December 25th, 2025');
    expect(normalizeToRoamDate('2026-02-02')).toBe('February 2nd, 2026');
    expect(normalizeToRoamDate('2026-03-03')).toBe('March 3rd, 2026');
    expect(normalizeToRoamDate('2026-11-11')).toBe('November 11th, 2026');
    expect(normalizeToRoamDate('2026-04-12')).toBe('April 12th, 2026');
    expect(normalizeToRoamDate('2026-04-13')).toBe('April 13th, 2026');
  });

  it('normalizes US slash dates (MM/DD/YYYY)', () => {
    expect(normalizeToRoamDate('03/21/2026')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('3/21/2026')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('12/25/2025')).toBe('December 25th, 2025');
    expect(normalizeToRoamDate('1/1/2024')).toBe('January 1st, 2024');
  });

  it('detects unambiguous EU numeric dates (DD/MM/YYYY where DD > 12)', () => {
    expect(normalizeToRoamDate('14/03/2025')).toBe('March 14th, 2025');
    expect(normalizeToRoamDate('21/01/2026')).toBe('January 21st, 2026');
    expect(normalizeToRoamDate('25/12/2025')).toBe('December 25th, 2025');
    expect(normalizeToRoamDate('31/01/2026')).toBe('January 31st, 2026');
    expect(normalizeToRoamDate('13/06/2026')).toBe('June 13th, 2026');
  });

  it('treats ambiguous numeric dates as US (MM/DD/YYYY when both ≤ 12)', () => {
    // 03/04/2026 is ambiguous — defaults to US: March 4th
    expect(normalizeToRoamDate('03/04/2026')).toBe('March 4th, 2026');
    expect(normalizeToRoamDate('01/02/2026')).toBe('January 2nd, 2026');
  });

  it('normalizes US dash dates (MM-DD-YYYY)', () => {
    expect(normalizeToRoamDate('03-21-2026')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('01-25-2026')).toBe('January 25th, 2026');
  });

  it('normalizes named month dates without ordinal', () => {
    expect(normalizeToRoamDate('March 21, 2026')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('January 1, 2024')).toBe('January 1st, 2024');
    expect(normalizeToRoamDate('December 25 2025')).toBe('December 25th, 2025');
  });

  it('normalizes abbreviated month names', () => {
    expect(normalizeToRoamDate('Mar 21, 2026')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('Jan 1, 2024')).toBe('January 1st, 2024');
    expect(normalizeToRoamDate('Dec 25, 2025')).toBe('December 25th, 2025');
  });

  it('normalizes named month with day only (no year, assumes current year)', () => {
    const year = new Date().getFullYear();
    expect(normalizeToRoamDate('March 21')).toBe(`March 21st, ${year}`);
    expect(normalizeToRoamDate('Jan 1')).toBe(`January 1st, ${year}`);
    expect(normalizeToRoamDate('Dec 25')).toBe(`December 25th, ${year}`);
  });

  it('handles named dates with existing ordinal suffix', () => {
    expect(normalizeToRoamDate('March 21st, 2026')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('January 2nd, 2026')).toBe('January 2nd, 2026');
    expect(normalizeToRoamDate('April 3rd 2026')).toBe('April 3rd, 2026');
  });

  it('normalizes EU day-first dates with named month', () => {
    expect(normalizeToRoamDate('21 March 2026')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('21 Mar 2026')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('1 January 2024')).toBe('January 1st, 2024');
    expect(normalizeToRoamDate('25 Dec 2025')).toBe('December 25th, 2025');
    expect(normalizeToRoamDate('21-Mar-2026')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('2-Feb-2026')).toBe('February 2nd, 2026');
  });

  it('normalizes EU day-first dates without year (assumes current year)', () => {
    const year = new Date().getFullYear();
    expect(normalizeToRoamDate('21 March')).toBe(`March 21st, ${year}`);
    expect(normalizeToRoamDate('21 Mar')).toBe(`March 21st, ${year}`);
    expect(normalizeToRoamDate('1 Jan')).toBe(`January 1st, ${year}`);
    expect(normalizeToRoamDate('25-Dec')).toBe(`December 25th, ${year}`);
  });

  it('rejects invalid dates', () => {
    expect(normalizeToRoamDate('2026-02-30')).toBeNull();  // Feb 30 doesn't exist
    expect(normalizeToRoamDate('2026-13-01')).toBeNull();  // Month 13
    expect(normalizeToRoamDate('2026-00-01')).toBeNull();  // Month 0
    expect(normalizeToRoamDate('13/32/2026')).toBeNull();  // Invalid month/day
  });

  it('handles all ordinal suffixes correctly', () => {
    expect(normalizeToRoamDate('2026-03-01')).toBe('March 1st, 2026');
    expect(normalizeToRoamDate('2026-03-02')).toBe('March 2nd, 2026');
    expect(normalizeToRoamDate('2026-03-03')).toBe('March 3rd, 2026');
    expect(normalizeToRoamDate('2026-03-04')).toBe('March 4th, 2026');
    expect(normalizeToRoamDate('2026-03-11')).toBe('March 11th, 2026');
    expect(normalizeToRoamDate('2026-03-12')).toBe('March 12th, 2026');
    expect(normalizeToRoamDate('2026-03-13')).toBe('March 13th, 2026');
    expect(normalizeToRoamDate('2026-03-21')).toBe('March 21st, 2026');
    expect(normalizeToRoamDate('2026-03-22')).toBe('March 22nd, 2026');
    expect(normalizeToRoamDate('2026-03-23')).toBe('March 23rd, 2026');
    expect(normalizeToRoamDate('2026-03-31')).toBe('March 31st, 2026');
  });
});

describe('resolveRelativeDate', () => {
  it('resolves "today" to current date in Roam format', () => {
    expect(resolveRelativeDate('today')).toBe(formatRoamDate(new Date()));
  });

  it('resolves "yesterday"', () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    expect(resolveRelativeDate('yesterday')).toBe(formatRoamDate(y));
  });

  it('resolves "tomorrow"', () => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    expect(resolveRelativeDate('tomorrow')).toBe(formatRoamDate(t));
  });

  it('normalizes ISO dates via fallback', () => {
    expect(resolveRelativeDate('2026-03-21')).toBe('March 21st, 2026');
  });

  it('normalizes slash dates via fallback', () => {
    expect(resolveRelativeDate('03/21/2026')).toBe('March 21st, 2026');
  });

  it('returns non-date strings unchanged', () => {
    expect(resolveRelativeDate('My Page')).toBe('My Page');
    expect(resolveRelativeDate('Recipes')).toBe('Recipes');
  });
});
