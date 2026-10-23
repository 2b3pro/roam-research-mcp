import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isDailyPageUid,
  dailyUidToTitle,
  extractParentUids
} from './page-validator.js';
import { PageUidCache } from '../cache/page-uid-cache.js';

const pageUidCache = new PageUidCache();

describe('page-validator', () => {
  beforeEach(() => {
    pageUidCache.clear();
  });

  describe('isDailyPageUid', () => {
    it('should recognize valid daily page UIDs', () => {
      expect(isDailyPageUid('01-25-2026')).toBe(true);
      expect(isDailyPageUid('12-31-2024')).toBe(true);
      expect(isDailyPageUid('01-01-2000')).toBe(true);
      expect(isDailyPageUid('06-15-2050')).toBe(true);
    });

    it('should reject invalid formats', () => {
      // Wrong separators
      expect(isDailyPageUid('01/25/2026')).toBe(false);
      expect(isDailyPageUid('01.25.2026')).toBe(false);

      // Wrong order (YYYY-MM-DD)
      expect(isDailyPageUid('2026-01-25')).toBe(false);

      // Standard 9-char block UID
      expect(isDailyPageUid('abc123def')).toBe(false);
      expect(isDailyPageUid('XrXmQJ-vO')).toBe(false);

      // Too short/long
      expect(isDailyPageUid('1-25-2026')).toBe(false);
      expect(isDailyPageUid('001-25-2026')).toBe(false);
    });

    it('should reject invalid month/day values', () => {
      expect(isDailyPageUid('13-25-2026')).toBe(false); // Month > 12
      expect(isDailyPageUid('00-25-2026')).toBe(false); // Month = 0
      expect(isDailyPageUid('01-32-2026')).toBe(false); // Day > 31
      expect(isDailyPageUid('01-00-2026')).toBe(false); // Day = 0
    });

    it('should reject years outside reasonable range', () => {
      expect(isDailyPageUid('01-25-1999')).toBe(false); // Year < 2000
      expect(isDailyPageUid('01-25-2101')).toBe(false); // Year > 2100
    });
  });

  describe('dailyUidToTitle', () => {
    it('should convert UID to Roam date title format', () => {
      expect(dailyUidToTitle('01-25-2026')).toBe('January 25th, 2026');
      expect(dailyUidToTitle('12-31-2024')).toBe('December 31st, 2024');
      expect(dailyUidToTitle('01-01-2025')).toBe('January 1st, 2025');
      expect(dailyUidToTitle('02-02-2025')).toBe('February 2nd, 2025');
      expect(dailyUidToTitle('03-03-2025')).toBe('March 3rd, 2025');
      expect(dailyUidToTitle('04-04-2025')).toBe('April 4th, 2025');
      expect(dailyUidToTitle('05-11-2025')).toBe('May 11th, 2025'); // 11th exception
      expect(dailyUidToTitle('06-12-2025')).toBe('June 12th, 2025'); // 12th exception
      expect(dailyUidToTitle('07-13-2025')).toBe('July 13th, 2025'); // 13th exception
      expect(dailyUidToTitle('08-21-2025')).toBe('August 21st, 2025');
      expect(dailyUidToTitle('09-22-2025')).toBe('September 22nd, 2025');
      expect(dailyUidToTitle('10-23-2025')).toBe('October 23rd, 2025');
    });

    it('should throw for invalid format', () => {
      expect(() => dailyUidToTitle('abc123def')).toThrow('Invalid daily page UID format');
      expect(() => dailyUidToTitle('2026-01-25')).toThrow('Invalid daily page UID format');
    });
  });

  describe('extractParentUids', () => {
    it('should extract parent-uid from actions', () => {
      const actions = [
        { action: 'create-block', location: { 'parent-uid': 'abc123def' }, block: { string: 'test' } },
        { action: 'create-block', location: { 'parent-uid': 'xyz789uvw' }, block: { string: 'test2' } }
      ];
      const uids = extractParentUids(actions);
      expect(uids).toHaveLength(2);
      expect(uids).toContain('abc123def');
      expect(uids).toContain('xyz789uvw');
    });

    it('should deduplicate UIDs', () => {
      const actions = [
        { action: 'create-block', location: { 'parent-uid': 'abc123def' }, block: { string: 'test' } },
        { action: 'create-block', location: { 'parent-uid': 'abc123def' }, block: { string: 'test2' } }
      ];
      const uids = extractParentUids(actions);
      expect(uids).toHaveLength(1);
      expect(uids[0]).toBe('abc123def');
    });

    it('should skip UID placeholders', () => {
      const actions = [
        { action: 'create-block', location: { 'parent-uid': '{{uid:parent1}}' }, block: { string: 'test' } },
        { action: 'create-block', location: { 'parent-uid': 'abc123def' }, block: { string: 'test2' } }
      ];
      const uids = extractParentUids(actions);
      expect(uids).toHaveLength(1);
      expect(uids[0]).toBe('abc123def');
    });

    it('should handle actions without location', () => {
      const actions = [
        { action: 'update-block', uid: 'abc123def', block: { string: 'test' } },
        { action: 'delete-block', uid: 'xyz789uvw' }
      ];
      const uids = extractParentUids(actions);
      expect(uids).toHaveLength(0);
    });

    it('should handle empty actions', () => {
      const uids = extractParentUids([]);
      expect(uids).toHaveLength(0);
    });
  });

  describe('pageUidCache integration', () => {
    it('should track known UIDs', () => {
      expect(pageUidCache.hasUid('abc123def')).toBe(false);
      pageUidCache.addUid('abc123def');
      expect(pageUidCache.hasUid('abc123def')).toBe(true);
    });

    it('should track multiple UIDs at once', () => {
      pageUidCache.addUids(['uid1', 'uid2', 'uid3']);
      expect(pageUidCache.hasUid('uid1')).toBe(true);
      expect(pageUidCache.hasUid('uid2')).toBe(true);
      expect(pageUidCache.hasUid('uid3')).toBe(true);
      expect(pageUidCache.hasUid('uid4')).toBe(false);
    });

    it('should auto-add UID when setting title mapping', () => {
      pageUidCache.set('Test Page', 'testuid12');
      expect(pageUidCache.hasUid('testuid12')).toBe(true);
    });

    it('should clear both caches', () => {
      pageUidCache.set('Test Page', 'testuid12');
      pageUidCache.addUid('otheruid99');
      expect(pageUidCache.size).toBe(1);
      expect(pageUidCache.uidCacheSize).toBe(2);

      pageUidCache.clear();
      expect(pageUidCache.size).toBe(0);
      expect(pageUidCache.uidCacheSize).toBe(0);
    });
  });
});
