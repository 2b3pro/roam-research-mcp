import type { SearchMatch } from '../../search/types.js';

export type SortField = 'created' | 'modified' | 'page';
export type SortDirection = 'asc' | 'desc';
export type GroupByField = 'page' | 'tag';

export interface SortOptions {
  field: SortField;
  direction: SortDirection;
}

export interface GroupOptions {
  by: GroupByField;
  searchTag?: string; // The primary tag used in search, for filtering subtags
}

export interface GroupedResults {
  groups: Record<string, SearchMatch[]>;
  meta: {
    total: number;
    groups_count: number;
  };
}

/**
 * Sort search results by a specified field and direction
 */
export function sortResults(matches: SearchMatch[], options: SortOptions): SearchMatch[] {
  const { field, direction } = options;
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...matches].sort((a, b) => {
    let comparison = 0;

    switch (field) {
      case 'created':
        comparison = (a.created || 0) - (b.created || 0);
        break;
      case 'modified':
        comparison = (a.modified || 0) - (b.modified || 0);
        break;
      case 'page':
        comparison = (a.page_title || '').localeCompare(b.page_title || '');
        break;
    }

    return comparison * multiplier;
  });
}

/**
 * Group search results by page title
 */
export function groupByPage(matches: SearchMatch[]): GroupedResults {
  const groups: Record<string, SearchMatch[]> = {};

  for (const match of matches) {
    const key = match.page_title || '(No Page)';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(match);
  }

  return {
    groups,
    meta: {
      total: matches.length,
      groups_count: Object.keys(groups).length
    }
  };
}

/**
 * Group search results by tag
 * Matches are grouped by the most specific matching subtag of the search tag
 * Each match appears only once, under its most specific matching tag
 */
export function groupByTag(matches: SearchMatch[], searchTag: string): GroupedResults {
  const groups: Record<string, SearchMatch[]> = {};
  const normalizedSearchTag = normalizeTagName(searchTag);

  for (const match of matches) {
    const tags = match.tags || [];

    // Find the most specific matching tag (longest path that starts with searchTag)
    let bestTag = searchTag; // Default to the search tag itself
    let bestLength = 0;

    for (const tag of tags) {
      const normalizedTag = normalizeTagName(tag);

      // Check if this tag matches or is a subtag of the search tag
      if (normalizedTag === normalizedSearchTag ||
          normalizedTag.startsWith(normalizedSearchTag + '/')) {
        if (normalizedTag.length > bestLength) {
          bestTag = tag;
          bestLength = normalizedTag.length;
        }
      }
    }

    // Group under the best matching tag
    if (!groups[bestTag]) {
      groups[bestTag] = [];
    }
    groups[bestTag].push(match);
  }

  // Sort groups by tag name for consistent output
  const sortedGroups: Record<string, SearchMatch[]> = {};
  const sortedKeys = Object.keys(groups).sort();
  for (const key of sortedKeys) {
    sortedGroups[key] = groups[key];
  }

  return {
    groups: sortedGroups,
    meta: {
      total: matches.length,
      groups_count: Object.keys(sortedGroups).length
    }
  };
}

/**
 * Group results by specified field
 */
export function groupResults(
  matches: SearchMatch[],
  options: GroupOptions
): GroupedResults {
  switch (options.by) {
    case 'page':
      return groupByPage(matches);
    case 'tag':
      return groupByTag(matches, options.searchTag || '');
  }
}

/**
 * Normalize tag name for comparison (lowercase, trim whitespace)
 */
function normalizeTagName(tag: string): string {
  return tag.toLowerCase().trim();
}

/**
 * Get default sort direction for a field
 */
export function getDefaultDirection(field: SortField): SortDirection {
  // Dates default to descending (newest first), alphabetical to ascending
  return field === 'page' ? 'asc' : 'desc';
}
