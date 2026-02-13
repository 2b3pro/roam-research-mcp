// Helper function to get ordinal suffix for numbers (1st, 2nd, 3rd, etc.)
export function getOrdinalSuffix(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

// Format date in Roam's preferred format (e.g., "January 1st, 2024")
export function formatRoamDate(date: Date): string {
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}${getOrdinalSuffix(day)}, ${year}`;
}

/**
 * Parse a Roam Research URL and extract the page/block UID.
 * Handles URLs like:
 * - https://roamresearch.com/#/app/graph-name/page/page_uid
 * - https://roamresearch.com/#/app/graph-name/page/page_uid?version=...
 *
 * Returns null if the URL doesn't match expected patterns.
 */
export function parseRoamUrl(url: string): { type: 'page' | 'block'; uid: string; graph?: string } | null {
  // Match Roam URL pattern: roamresearch.com/#/app/<graph>/page/<uid>
  const pagePattern = /roamresearch\.com\/#\/app\/([^/]+)\/page\/([a-zA-Z0-9_-]{9})/;
  const pageMatch = url.match(pagePattern);

  if (pageMatch) {
    return {
      type: 'page',
      uid: pageMatch[2],
      graph: pageMatch[1]
    };
  }

  return null;
}

/**
 * Check if a string looks like a Roam UID (9 alphanumeric characters).
 */
export function isRoamUid(str: string): boolean {
  return /^[a-zA-Z0-9_-]{9}$/.test(str);
}

/**
 * Sanitize a tag/category name by stripping Roam formatting artifacts.
 * Handles: "#Tag" → "Tag", "#[[Tag]]" → "Tag", "[[Tag]]" → "Tag", "##Tag" → "Tag"
 * Allows callers to safely prepend their own # or #[[...]] formatting.
 */
export function sanitizeTagName(tag: string): string {
  let cleaned = tag.trim();
  cleaned = cleaned.replace(/^#+/, '');
  cleaned = cleaned.replace(/^\[\[/, '').replace(/\]\]$/, '');
  return cleaned.trim();
}

/**
 * Resolve relative date keywords to Roam date format.
 * Returns the original string if not a recognized keyword.
 */
export function resolveRelativeDate(input: string): string {
  const lower = input.toLowerCase().trim();
  const today = new Date();

  switch (lower) {
    case 'today':
      return formatRoamDate(today);
    case 'yesterday':
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return formatRoamDate(yesterday);
    case 'tomorrow':
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      return formatRoamDate(tomorrow);
    default:
      return input;
  }
}
