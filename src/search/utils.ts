import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import type { SearchResult } from './types.js';

export class SearchUtils {
  /**
   * Find a page by title or UID
   */
  static async findPageByTitleOrUid(graph: Graph, titleOrUid: string): Promise<string> {
    // Try to find page by title
    const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
    const findResults = await q(graph, findQuery, [titleOrUid]) as [string][];
    
    if (findResults && findResults.length > 0) {
      return findResults[0][0];
    }

    // Try as UID
    const uidQuery = `[:find ?uid :where [?e :block/uid "${titleOrUid}"] [?e :block/uid ?uid]]`;
    const uidResults = await q(graph, uidQuery, []) as [string][];
    
    if (!uidResults || uidResults.length === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Page with title/UID "${titleOrUid}" not found`
      );
    }

    return uidResults[0][0];
  }

  /**
   * Format search results into a standard structure
   * Supports both basic [uid, content, pageTitle?] and extended [uid, content, pageTitle?, created?, modified?] formats
   */
  static formatSearchResults(
    results: [string, string, string?, number?, number?][],
    searchDescription: string,
    includePageTitle: boolean = true
  ): SearchResult {
    if (!results || results.length === 0) {
      return {
        success: true,
        matches: [],
        message: `No blocks found ${searchDescription}`
      };
    }

    const matches = results.map(([uid, content, pageTitle, created, modified]) => ({
      block_uid: uid,
      content,
      ...(includePageTitle && pageTitle && { page_title: pageTitle }),
      ...(created && { created }),
      ...(modified && { modified })
    }));

    return {
      success: true,
      matches,
      message: `Found ${matches.length} block(s) ${searchDescription}`
    };
  }

  /**
   * Format a tag for searching, handling both # and [[]] formats
   * @param tag Tag without prefix
   * @returns Array of possible formats to search for
   */
  static formatTag(tag: string): string[] {
    // Remove any existing prefixes
    const cleanTag = tag.replace(/^#|\[\[|\]\]$/g, '');
    // Return both formats for comprehensive search
    return [`#${cleanTag}`, `[[${cleanTag}]]`];
  }

  /**
   * Parse a date string into a Roam-formatted date
   */
  static parseDate(dateStr: string): string {
    const date = new Date(dateStr);
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    // Adjust for timezone to ensure consistent date comparison
    const utcDate = new Date(date.getTime() + date.getTimezoneOffset() * 60000);
    return `${months[utcDate.getMonth()]} ${utcDate.getDate()}${this.getOrdinalSuffix(utcDate.getDate())}, ${utcDate.getFullYear()}`;
  }

  /**
   * Parse a date string into a Roam-formatted date range
   * Returns [startDate, endDate] with endDate being inclusive (end of day)
   */
  static parseDateRange(startStr: string, endStr: string): [string, string] {
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    endDate.setHours(23, 59, 59, 999); // Make end date inclusive

    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Adjust for timezone
    const utcStart = new Date(startDate.getTime() + startDate.getTimezoneOffset() * 60000);
    const utcEnd = new Date(endDate.getTime() + endDate.getTimezoneOffset() * 60000);

    return [
      `${months[utcStart.getMonth()]} ${utcStart.getDate()}${this.getOrdinalSuffix(utcStart.getDate())}, ${utcStart.getFullYear()}`,
      `${months[utcEnd.getMonth()]} ${utcEnd.getDate()}${this.getOrdinalSuffix(utcEnd.getDate())}, ${utcEnd.getFullYear()}`
    ];
  }

  private static getOrdinalSuffix(day: number): string {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  /**
   * Fetch all tag references for a set of block UIDs
   * Returns a map of block_uid -> array of tag titles
   */
  static async fetchBlockTags(graph: Graph, blockUids: string[]): Promise<Map<string, string[]>> {
    if (blockUids.length === 0) {
      return new Map();
    }

    // Build OR clause for all UIDs
    const uidClauses = blockUids.map(uid => `[?b :block/uid "${uid}"]`).join(' ');

    const queryStr = `[:find ?block-uid ?tag-title
                      :where
                      (or ${uidClauses})
                      [?b :block/uid ?block-uid]
                      [?b :block/refs ?ref]
                      [?ref :node/title ?tag-title]]`;

    const results = await q(graph, queryStr, []) as [string, string][];

    // Group tags by block UID
    const tagMap = new Map<string, string[]>();
    for (const [uid, tag] of results) {
      if (!tagMap.has(uid)) {
        tagMap.set(uid, []);
      }
      tagMap.get(uid)!.push(tag);
    }

    return tagMap;
  }
}
