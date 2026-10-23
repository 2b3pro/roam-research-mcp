import type { Graph } from '@roam-research/roam-api-sdk';
import { resolveRefsMany } from '../tools/helpers/refs.js';

export interface SearchMatch {
  block_uid: string;
  content: string;
  page_title?: string;
  created?: number;   // Unix timestamp (ms) from :create/time
  modified?: number;  // Unix timestamp (ms) from :edit/time
  tags?: string[];    // Tag references for grouping
  [key: string]: any; // Additional context-specific fields
}

export interface SearchResult {
  success: boolean;
  matches: SearchMatch[];
  message: string;
  total_count?: number; // Added for total count of matches
}

export interface SearchHandler {
  execute(): Promise<SearchResult>;
}

// Tag Search Types
export interface TagSearchParams {
  primary_tag: string;
  page_title_uid?: string;
  near_tag?: string;
  exclude_tag?: string;
  case_sensitive?: boolean;
  limit?: number;
  offset?: number;
}

// Text Search Types
export interface TextSearchParams {
  text: string;
  page_title_uid?: string;
  case_sensitive?: boolean;
  limit?: number;
  offset?: number;
  scope?: 'blocks' | 'page_titles';
}

// Base class for all search handlers
export abstract class BaseSearchHandler implements SearchHandler {
  constructor(protected graph: Graph) { }
  abstract execute(): Promise<SearchResult>;

  /**
   * Resolve block references in search results.
   * Handles both 5-tuple [uid, content, pageTitle?, created?, modified?]
   * and 3-tuple [uid, content, pageTitle?] formats.
   */
  protected async resolveBlockRefs<T extends [string, string, ...any[]]>(
    results: T[]
  ): Promise<T[]> {
    const contents = await resolveRefsMany(this.graph, results.map(result => result[1]));
    return results.map((result, index) => [result[0], contents[index], ...result.slice(2)] as T);
  }
}
