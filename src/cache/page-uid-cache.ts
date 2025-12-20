/**
 * Simple in-memory cache for page title -> UID mappings.
 * Pages are stable entities that rarely get deleted, making them safe to cache.
 * This reduces redundant API queries when looking up the same page multiple times.
 */
class PageUidCache {
  private cache = new Map<string, string>(); // title (lowercase) -> UID

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
   * @param title - Page title (will be stored lowercase)
   * @param uid - Page UID
   */
  set(title: string, uid: string): void {
    this.cache.set(title.toLowerCase(), uid);
  }

  /**
   * Check if a page title is cached.
   * @param title - Page title (case-insensitive)
   */
  has(title: string): boolean {
    return this.cache.has(title.toLowerCase());
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
  }

  /**
   * Get the current cache size.
   */
  get size(): number {
    return this.cache.size;
  }
}

// Singleton instance - shared across all operations
export const pageUidCache = new PageUidCache();
