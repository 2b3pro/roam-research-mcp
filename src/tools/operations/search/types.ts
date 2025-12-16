import type { SearchResult } from '../../types/index.js';

// Base search parameters
export interface BaseSearchParams {
  page_title_uid?: string;
}

// Datomic search parameters
export interface DatomicSearchParams {
  query: string;
  inputs?: unknown[];
}

// Tag search parameters
export interface TagSearchParams extends BaseSearchParams {
  primary_tag: string;
  near_tag?: string;
}

// Block reference search parameters
export interface BlockRefSearchParams extends BaseSearchParams {
  block_uid?: string;
}

// Hierarchy search parameters
export interface HierarchySearchParams extends BaseSearchParams {
  parent_uid?: string;
  child_uid?: string;
  max_depth?: number;
}

// Text search parameters
export interface TextSearchParams extends BaseSearchParams {
  text: string;
}

// Status search parameters
export interface StatusSearchParams extends BaseSearchParams {
  status: 'TODO' | 'DONE';
}

// Common search result type
export interface SearchHandlerResult {
  success: boolean;
  matches: SearchResult[];
  message: string;
}
