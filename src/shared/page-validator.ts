/**
 * Page existence validator for batch operations.
 *
 * Provides rate-limit-friendly validation of parent UIDs before batch execution.
 * Uses caching and batched queries to minimize API calls.
 *
 * Key features:
 * - Session-scoped cache for known UIDs (no stale data across restarts)
 * - Single batched Datomic query to check multiple UIDs
 * - Auto-creation of daily pages (detected by MM-DD-YYYY format)
 * - Clear error messages for missing non-daily pages
 */

import { Graph, q, createPage as createRoamPage } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { pageUidCache } from '../cache/page-uid-cache.js';
import { isRateLimitError } from './errors.js';

// Daily page UID format: MM-DD-YYYY (e.g., "01-25-2026")
const DAILY_PAGE_UID_REGEX = /^(\d{2})-(\d{2})-(\d{4})$/;

/**
 * Rate limit configuration for validation operations.
 */
interface RateLimitConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};

/**
 * Sleep helper for delays.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if a UID matches the daily page format (MM-DD-YYYY).
 * These pages can be safely auto-created.
 */
export function isDailyPageUid(uid: string): boolean {
  const match = uid.match(DAILY_PAGE_UID_REGEX);
  if (!match) return false;

  const [, month, day, year] = match;
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  const y = parseInt(year, 10);

  // Basic validation: month 1-12, day 1-31, year reasonable
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100;
}

/**
 * Convert daily page UID (MM-DD-YYYY) to Roam date title format.
 * Example: "01-25-2026" -> "January 25th, 2026"
 */
export function dailyUidToTitle(uid: string): string {
  const match = uid.match(DAILY_PAGE_UID_REGEX);
  if (!match) {
    throw new Error(`Invalid daily page UID format: ${uid}`);
  }

  const [, month, day, year] = match;
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));

  const monthName = date.toLocaleString('en-US', { month: 'long' });
  const dayNum = date.getDate();
  const yearNum = date.getFullYear();

  // Get ordinal suffix
  const j = dayNum % 10;
  const k = dayNum % 100;
  let suffix: string;
  if (j === 1 && k !== 11) suffix = 'st';
  else if (j === 2 && k !== 12) suffix = 'nd';
  else if (j === 3 && k !== 13) suffix = 'rd';
  else suffix = 'th';

  return `${monthName} ${dayNum}${suffix}, ${yearNum}`;
}

/**
 * Batch check existence of multiple UIDs with a single Datomic query.
 * Returns the set of UIDs that exist.
 */
async function batchCheckExistence(
  graph: Graph,
  uids: string[],
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): Promise<Set<string>> {
  if (uids.length === 0) return new Set();

  // Build query with IN clause for multiple UIDs
  // This checks for any entity (page or block) with the given UID
  const query = `[:find ?uid
                  :in $ [?uid ...]
                  :where [?e :block/uid ?uid]]`;

  let lastError: Error | undefined;
  let delay = config.initialDelayMs;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const results = await q(graph, query, [uids]) as [string][];
      const existingUids = new Set(results.map(([uid]) => uid));
      return existingUids;
    } catch (error) {
      if (!isRateLimitError(error)) {
        throw error;
      }

      lastError = error as Error;
      if (attempt < config.maxRetries) {
        const waitTime = Math.min(delay, config.maxDelayMs);
        console.log(`[page-validator] Rate limited on existence check, retrying in ${waitTime}ms (attempt ${attempt + 1}/${config.maxRetries})`);
        await sleep(waitTime);
        delay *= config.backoffMultiplier;
      }
    }
  }

  throw new McpError(
    ErrorCode.InternalError,
    `Rate limit exceeded checking page existence after ${config.maxRetries} retries: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Check whether a single UID names an existing entity (page or block).
 * Shares the session cache with `ensurePagesExist`, so a UID confirmed here is
 * not queried again when a batch then writes under it.
 */
export async function uidExists(graph: Graph, uid: string): Promise<boolean> {
  if (pageUidCache.hasUid(uid)) return true;

  const existing = await batchCheckExistence(graph, [uid]);
  if (!existing.has(uid)) return false;

  pageUidCache.addUid(uid);
  return true;
}

/**
 * Batch create daily pages that don't exist.
 * Uses Roam's createPage API.
 */
async function batchCreateDailyPages(
  graph: Graph,
  uids: string[],
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): Promise<void> {
  if (uids.length === 0) return;

  // Create pages sequentially with small delays to avoid rate limits
  // Roam's createPage doesn't support true batching
  for (const uid of uids) {
    const title = dailyUidToTitle(uid);

    let lastError: Error | undefined;
    let delay = config.initialDelayMs;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        await createRoamPage(graph, {
          action: 'create-page',
          page: { title, uid }
        });

        // Cache the created page
        pageUidCache.onPageCreated(title, uid);
        console.log(`[page-validator] Created daily page: ${title} (${uid})`);

        // Small delay between page creations to be rate-limit friendly
        if (uids.indexOf(uid) < uids.length - 1) {
          await sleep(200);
        }
        break; // Success, move to next page
      } catch (error) {
        if (!isRateLimitError(error)) {
          // Non-rate-limit error - might be page already exists, which is OK
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes('already exists') || msg.includes('duplicate')) {
            pageUidCache.addUid(uid);
            break;
          }
          throw error;
        }

        lastError = error as Error;
        if (attempt < config.maxRetries) {
          const waitTime = Math.min(delay, config.maxDelayMs);
          console.log(`[page-validator] Rate limited creating ${uid}, retrying in ${waitTime}ms (attempt ${attempt + 1}/${config.maxRetries})`);
          await sleep(waitTime);
          delay *= config.backoffMultiplier;
        }
      }
    }

    if (lastError && !pageUidCache.hasUid(uid)) {
      throw new McpError(
        ErrorCode.InternalError,
        `Rate limit exceeded creating daily page ${uid} after ${config.maxRetries} retries: ${lastError.message}`
      );
    }
  }

  // Final delay to let Roam's eventual consistency settle
  if (uids.length > 0) {
    await sleep(400);
  }
}

/**
 * Extract all unique parent-uid values from batch actions.
 */
export function extractParentUids(actions: any[]): string[] {
  const uids = new Set<string>();

  for (const action of actions) {
    // Handle standard location format
    const parentUid = action.location?.['parent-uid'];
    if (parentUid && typeof parentUid === 'string') {
      // Skip UID placeholders like {{uid:parent1}}
      if (!parentUid.startsWith('{{uid:')) {
        uids.add(parentUid);
      }
    }
  }

  return [...uids];
}

/**
 * Validates all parent UIDs in a batch, auto-creating daily pages as needed.
 * Returns after all targets are guaranteed to exist.
 *
 * This is the main entry point for batch operation validation.
 *
 * @param graph - Roam graph connection
 * @param actions - Array of batch actions to validate
 * @param config - Optional rate limit configuration
 * @throws McpError if non-daily pages are missing
 */
export async function ensurePagesExist(
  graph: Graph,
  actions: any[],
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): Promise<{ checked: number; created: number; cached: number }> {
  // 1. Extract unique parent UIDs from actions
  const parentUids = extractParentUids(actions);

  if (parentUids.length === 0) {
    return { checked: 0, created: 0, cached: 0 };
  }

  // 2. Filter by cache - skip UIDs we know exist
  const uncachedUids = parentUids.filter(uid => !pageUidCache.hasUid(uid));
  const cachedCount = parentUids.length - uncachedUids.length;

  if (uncachedUids.length === 0) {
    // All UIDs are cached, no API calls needed
    return { checked: 0, created: 0, cached: cachedCount };
  }

  // 3. Single batched query to check existence
  const existingUids = await batchCheckExistence(graph, uncachedUids, config);

  // 4. Update cache with found UIDs
  pageUidCache.addUids([...existingUids]);

  // 5. Determine what's missing
  const missingUids = uncachedUids.filter(uid => !existingUids.has(uid));

  if (missingUids.length === 0) {
    return { checked: uncachedUids.length, created: 0, cached: cachedCount };
  }

  // 6. Separate daily pages from other pages
  const dailyMissing = missingUids.filter(isDailyPageUid);
  const otherMissing = missingUids.filter(uid => !isDailyPageUid(uid));

  // 7. Fail fast if non-daily pages are missing
  if (otherMissing.length > 0) {
    const examples = otherMissing.slice(0, 3).join(', ');
    const more = otherMissing.length > 3 ? ` and ${otherMissing.length - 3} more` : '';
    throw new McpError(
      ErrorCode.InvalidParams,
      `Parent page(s) do not exist: ${examples}${more}. Create them first with roam_create_page or use a valid existing page UID.`
    );
  }

  // 8. Auto-create missing daily pages
  if (dailyMissing.length > 0) {
    await batchCreateDailyPages(graph, dailyMissing, config);
  }

  return {
    checked: uncachedUids.length,
    created: dailyMissing.length,
    cached: cachedCount
  };
}
