/**
 * Resolver for page/block title lookups before batch execution
 */

import { Graph, q } from '@roam-research/roam-api-sdk';
import { capitalizeWords } from '../../tools/helpers/text.js';
import { formatRoamDate } from '../../utils/helpers.js';
import { pageUidCache } from '../../cache/page-uid-cache.js';
import type { BatchCommand, ResolutionContext } from './types.js';

/**
 * Resolve a page title to its UID, trying multiple case variations
 */
export async function resolvePageUid(graph: Graph, title: string): Promise<string | null> {
  // Check cache first
  const cachedUid = pageUidCache.get(title);
  if (cachedUid) {
    return cachedUid;
  }

  // Try different case variations
  const variations = [
    title,
    capitalizeWords(title),
    title.toLowerCase()
  ];

  const orClause = variations.map(v => `[?e :node/title "${v}"]`).join(' ');
  const searchQuery = `[:find ?uid .
                        :where [?e :block/uid ?uid]
                               (or ${orClause})]`;

  const result = await q(graph, searchQuery, []);
  const uid = (result === null || result === undefined) ? null : String(result);

  // Cache the result
  if (uid) {
    pageUidCache.set(title, uid);
  }

  return uid;
}

/**
 * Get today's daily page title in Roam format
 */
export function getDailyPageTitle(): string {
  return formatRoamDate(new Date());
}

/**
 * Resolve today's daily page UID
 */
export async function resolveDailyPageUid(graph: Graph): Promise<string | null> {
  const dailyTitle = getDailyPageTitle();
  return resolvePageUid(graph, dailyTitle);
}

/**
 * Check if a string looks like a valid Roam UID (not a page title)
 */
export function isUidFormat(ref: string): boolean {
  // 9 alphanumeric characters (standard block UID)
  if (/^[a-zA-Z0-9_-]{9}$/.test(ref)) return true;
  // MM-DD-YYYY daily page UID
  if (/^\d{2}-\d{2}-\d{4}$/.test(ref)) return true;
  // Placeholder {{name}}
  if (/^\{\{[^}]+\}\}$/.test(ref)) return true;
  return false;
}

/**
 * Collect all unique page titles that need resolution from commands
 */
export function collectPageTitles(commands: BatchCommand[]): Set<string> {
  const titles = new Set<string>();

  for (const cmd of commands) {
    const params = cmd.params as Record<string, unknown>;

    // Commands that can have 'page' param
    if ('page' in params && typeof params.page === 'string') {
      titles.add(params.page);
    }

    // Commands that can have 'parent' param — if it looks like a page title, resolve it
    if ('parent' in params && typeof params.parent === 'string') {
      const parent = params.parent;
      if (!isUidFormat(parent)) {
        titles.add(parent);
      }
    }

    // Remember command can have heading that needs parent page resolution
    // But heading lookup is handled separately

    // Todo/remember without explicit page need daily page
    if (cmd.command === 'todo' || cmd.command === 'remember') {
      if (!('page' in params) && !('pageUid' in params) && !('parent' in params)) {
        titles.add(getDailyPageTitle());
      }
    }
  }

  return titles;
}

/**
 * Check if any commands need daily page resolution
 */
export function needsDailyPage(commands: BatchCommand[]): boolean {
  for (const cmd of commands) {
    const params = cmd.params as Record<string, unknown>;

    if (cmd.command === 'todo' || cmd.command === 'remember') {
      if (!('page' in params) && !('pageUid' in params) && !('parent' in params)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Resolve all page titles to UIDs
 * Returns a map of title -> uid
 */
export async function resolveAllPages(
  graph: Graph,
  titles: Set<string>
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  // Resolve in parallel for efficiency
  const entries = Array.from(titles);
  const results = await Promise.all(
    entries.map(async (title) => {
      const uid = await resolvePageUid(graph, title);
      return [title, uid] as const;
    })
  );

  for (const [title, uid] of results) {
    if (uid) {
      resolved.set(title, uid);
    }
  }

  return resolved;
}

/**
 * Create initial resolution context
 */
export function createResolutionContext(): ResolutionContext {
  return {
    pageUids: new Map(),
    placeholders: new Map(),
    levelStack: [],
    currentParent: null,
    dailyPageUid: null
  };
}

/**
 * Resolve a parent reference - could be a UID, placeholder, or page title
 */
export function resolveParentRef(
  ref: string,
  context: ResolutionContext
): string | null {
  // Check if it's a placeholder reference {{name}}
  const placeholderMatch = ref.match(/^\{\{([^}]+)\}\}$/);
  if (placeholderMatch) {
    const name = placeholderMatch[1];
    return context.placeholders.get(name) || `{{uid:${name}}}`;
  }

  // Check if it's a resolved page title
  if (context.pageUids.has(ref)) {
    return context.pageUids.get(ref)!;
  }

  // If it looks like a UID, return as-is
  if (isUidFormat(ref)) {
    return ref;
  }

  // Not a UID and not resolved — this is a page title that wasn't collected/resolved
  // Return null so callers can handle it (should not happen if collectPageTitles is correct)
  return null;
}

/**
 * Generate a placeholder UID for tracking
 * Returns the placeholder in {{uid:name}} format for batch processing
 */
export function generatePlaceholder(name: string): string {
  return `{{uid:${name}}}`;
}
