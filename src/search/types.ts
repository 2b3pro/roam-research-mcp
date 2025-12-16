import type { Graph } from '@roam-research/roam-api-sdk';

export interface SearchResult {
  success: boolean;
  matches: Array<{
    block_uid: string;
    content: string;
    page_title?: string;
    [key: string]: any;  // Additional context-specific fields
  }>;
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
}

// Base class for all search handlers
export abstract class BaseSearchHandler implements SearchHandler {
  constructor(protected graph: Graph) { }
  abstract execute(): Promise<SearchResult>;
}
