import type { Graph } from '@roam-research/roam-api-sdk';

/**
 * Simple in-memory cache for page title -> UID mappings and UID existence tracking.
 * Pages are stable entities that rarely get deleted, making them safe to cache.
 * This reduces redundant API queries when looking up the same page multiple times.
 *
 * The cache tracks two things:
 * 1. Title -> UID mappings (for getPageUid lookups)
 * 2. Known existing UIDs (for existence validation before batch operations)
 */
export class PageUidCache {
  private cache = new Map<string, string>(); // title (lowercase) -> UID
  private knownUids = new Set<string>(); // UIDs confirmed to exist

  /**
   * Get a cached page UID by title.
   * @param title - Page title (case-insensitive)
   * @returns The cached UID or undefined if not cached
   */
  get(title: string): string | undefined {
    return this.cache.get(title.toLowerCase());
  }

  /**
   * Cache a page title -> UID mapping.
   * Also marks the UID as known to exist.
   * @param title - Page title (will be stored lowercase)
   * @param uid - Page UID
   */
  set(title: string, uid: string): void {
    this.cache.set(title.toLowerCase(), uid);
    this.knownUids.add(uid);
  }

  /**
   * Check if a page title is cached.
   * @param title - Page title (case-insensitive)
   */
  has(title: string): boolean {
    return this.cache.has(title.toLowerCase());
  }

  /**
   * Check if a UID is known to exist.
   * @param uid - Page or block UID
   */
  hasUid(uid: string): boolean {
    return this.knownUids.has(uid);
  }

  /**
   * Mark a UID as known to exist (without title mapping).
   * Use this when you've verified a UID exists but don't know/need its title.
   * @param uid - Page or block UID
   */
  addUid(uid: string): void {
    this.knownUids.add(uid);
  }

  /**
   * Mark multiple UIDs as known to exist.
   * @param uids - Array of page or block UIDs
   */
  addUids(uids: string[]): void {
    for (const uid of uids) {
      this.knownUids.add(uid);
    }
  }

  /**
   * Called when a page is created - immediately add to cache.
   * @param title - Page title
   * @param uid - Page UID
   */
  onPageCreated(title: string, uid: string): void {
    this.set(title, uid);
  }

  /**
   * Clear the cache (useful for testing or session reset).
   */
  clear(): void {
    this.cache.clear();
    this.knownUids.clear();
  }

  /**
   * Get the current title cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get the current known UIDs cache size.
   */
  get uidCacheSize(): number {
    return this.knownUids.size;
  }
}

// Cache by connection, not graph name: two credentials or endpoints must never
// share lookup/existence evidence. Weak keys let retired connections be collected.
const caches = new WeakMap<Graph, PageUidCache>();

export function getPageUidCache(graph: Graph): PageUidCache {
  let cache = caches.get(graph);
  if (!cache) {
    cache = new PageUidCache();
    caches.set(graph, cache);
  }
  return cache;
}
