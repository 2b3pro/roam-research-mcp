/**
 * Shared utilities for page UID resolution with caching and case-insensitive matching.
 */
import { Graph, q, createPage } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { formatRoamDate, normalizeToRoamDate } from '../../utils/helpers.js';
import { pageUidCache } from '../../cache/page-uid-cache.js';
import { capitalizeWords } from './text.js';

/**
 * Find a page UID by title with case variation matching and caching.
 * Tries: original, capitalized words, lowercase.
 * @returns The page UID or null if not found
 */
export async function getPageUid(graph: Graph, title: string): Promise<string | null> {
  if (!title) {
    return null;
  }

  // If the title looks like a date, normalize to Roam format
  const roamDate = normalizeToRoamDate(title);

  const variations = [
    title,
    ...(roamDate && roamDate !== title ? [roamDate] : []),
    capitalizeWords(title),
    title.toLowerCase()
  ];

  // Check cache first for any variation
  for (const variation of variations) {
    const cachedUid = pageUidCache.get(variation);
    if (cachedUid) {
      return cachedUid;
    }
  }

  // Query database with OR clause for all variations
  const orClause = variations.map(v => `[?e :node/title "${v}"]`).join(' ');
  const searchQuery = `[:find ?uid .
                      :where [?e :block/uid ?uid]
                             (or ${orClause})]`;

  const result = await q(graph, searchQuery, []);
  const uid = (result === null || result === undefined) ? null : String(result);

  if (uid) {
    pageUidCache.set(title, uid);
  }

  return uid;
}

/**
 * Get or create today's daily page.
 * @returns The page UID
 */
export async function getOrCreateTodayPage(graph: Graph): Promise<string> {
  const dateStr = formatRoamDate(new Date());

  // Check cache first
  const cachedUid = pageUidCache.get(dateStr);
  if (cachedUid) {
    return cachedUid;
  }

  // Try to find today's page
  const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
  const findResults = await q(graph, findQuery, [dateStr]) as [string][];

  if (findResults && findResults.length > 0) {
    const uid = findResults[0][0];
    pageUidCache.set(dateStr, uid);
    return uid;
  }

  // Create today's page
  await createPage(graph, {
    action: 'create-page',
    page: { title: dateStr }
  });

  // Fetch the newly created page UID
  const results = await q(graph, findQuery, [dateStr]) as [string][];
  if (!results || results.length === 0) {
    throw new McpError(
      ErrorCode.InternalError,
      "Could not find created today's page"
    );
  }

  const uid = results[0][0];
  pageUidCache.onPageCreated(dateStr, uid);
  return uid;
}

export interface FindOrCreatePageOptions {
  maxRetries?: number;
  delayMs?: number;
}

/**
 * Find or create a page by title or UID with retries and caching.
 * Tries case variations, checks if input is a UID, creates page if not found.
 * @returns The page UID
 */
export async function findOrCreatePage(
  graph: Graph,
  titleOrUid: string,
  options: FindOrCreatePageOptions = {}
): Promise<string> {
  const { maxRetries = 3, delayMs = 500 } = options;

  // If the input looks like a date, normalize to Roam format
  const roamDate = normalizeToRoamDate(titleOrUid);

  const variations = [
    titleOrUid,
    ...(roamDate && roamDate !== titleOrUid ? [roamDate] : []),
    capitalizeWords(titleOrUid),
    titleOrUid.toLowerCase()
  ];

  // Check cache first for any variation
  for (const variation of variations) {
    const cachedUid = pageUidCache.get(variation);
    if (cachedUid) {
      return cachedUid;
    }
  }

  const titleQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;

  for (let retry = 0; retry < maxRetries; retry++) {
    // Try each case variation
    for (const variation of variations) {
      const findResults = await q(graph, titleQuery, [variation]) as [string][];
      if (findResults && findResults.length > 0) {
        const uid = findResults[0][0];
        pageUidCache.set(titleOrUid, uid);
        return uid;
      }
    }

    // If not found as title, try as UID
    const uidQuery = `[:find ?uid
                      :where [?e :block/uid "${titleOrUid}"]
                             [?e :block/uid ?uid]]`;
    const uidResult = await q(graph, uidQuery, []);
    if (uidResult && uidResult.length > 0) {
      return (uidResult as [string][])[0][0];
    }

    // If still not found and this is the first retry, try to create the page
    if (retry === 0) {
      await createPage(graph, {
        action: 'create-page',
        page: { title: titleOrUid }
      });
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    if (retry < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // One more attempt to find after creation attempts
  for (const variation of variations) {
    const findResults = await q(graph, titleQuery, [variation]) as [string][];
    if (findResults && findResults.length > 0) {
      const uid = findResults[0][0];
      pageUidCache.onPageCreated(titleOrUid, uid);
      return uid;
    }
  }

  throw new McpError(
    ErrorCode.InvalidRequest,
    `Failed to find or create page "${titleOrUid}" after multiple attempts`
  );
}
