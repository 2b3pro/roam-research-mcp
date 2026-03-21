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

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTHS_SHORT: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

/**
 * Attempt to parse a string as a date and return Roam format ("March 21st, 2026").
 * Returns null if the string doesn't look like a date.
 *
 * Handles:
 *   - ISO:           2026-03-21
 *   - US slash/dash:  03/21/2026, 3/21/2026, 03-21-2026
 *   - Named:          March 21, 2026 / Mar 21, 2026 / March 21 2026
 *   - Named w/ ord:   March 21st, 2026 (already correct — returned as-is)
 *   - No year:        March 21 / Mar 21 (assumes current year)
 *   - EU day-first:   21 March 2026 / 21 Mar 2026 / 21-Mar-2026 / 21 March
 *   - Roam UID style: MM-DD-YYYY (daily page UIDs, also caught by US dash)
 */
export function normalizeToRoamDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;

  // Already in Roam format? (e.g., "March 21st, 2026")
  const roamFmt = /^([A-Z][a-z]+)\s+(\d{1,2})(st|nd|rd|th),\s*(\d{4})$/;
  const roamMatch = s.match(roamFmt);
  if (roamMatch) {
    const mi = MONTHS_LONG.indexOf(roamMatch[1]);
    if (mi !== -1) return s; // already correct
  }

  // ISO: 2026-03-21
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const isoMatch = s.match(iso);
  if (isoMatch) {
    year = parseInt(isoMatch[1]);
    month = parseInt(isoMatch[2]) - 1;
    day = parseInt(isoMatch[3]);
  }

  // Numeric slash or dash: 03/21/2026, 14/03/2025, 03-21-2026
  // If first number > 12, it can't be a month → unambiguously EU (DD/MM/YYYY)
  // Otherwise assume US (MM/DD/YYYY)
  if (month === undefined) {
    const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
    const numMatch = s.match(numeric);
    if (numMatch) {
      const a = parseInt(numMatch[1]);
      const b = parseInt(numMatch[2]);
      year = parseInt(numMatch[3]);
      if (a > 12 && b <= 12) {
        // Unambiguously EU: DD/MM/YYYY (first number can't be a month)
        day = a;
        month = b - 1;
      } else {
        // US default: MM/DD/YYYY
        month = a - 1;
        day = b;
      }
    }
  }

  // Named month with day and year: "March 21, 2026" / "Mar 21 2026"
  if (month === undefined) {
    const named = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/;
    const namedMatch = s.match(named);
    if (namedMatch) {
      const mi = MONTHS_SHORT[namedMatch[1].toLowerCase().slice(0, 3)];
      if (mi !== undefined) {
        month = mi;
        day = parseInt(namedMatch[2]);
        year = parseInt(namedMatch[3]);
      }
    }
  }

  // EU day-first with named month and year: "21 March 2026" / "21 Mar 2026" / "21-Mar-2026"
  if (month === undefined) {
    const eu = /^(\d{1,2})[\s-]([A-Za-z]+)[\s-](\d{4})$/;
    const euMatch = s.match(eu);
    if (euMatch) {
      const mi = MONTHS_SHORT[euMatch[2].toLowerCase().slice(0, 3)];
      if (mi !== undefined) {
        day = parseInt(euMatch[1]);
        month = mi;
        year = parseInt(euMatch[3]);
      }
    }
  }

  // EU day-first with named month, no year: "21 March" / "21 Mar"
  if (month === undefined) {
    const euNoYear = /^(\d{1,2})[\s-]([A-Za-z]+)$/;
    const euNoYearMatch = s.match(euNoYear);
    if (euNoYearMatch) {
      const mi = MONTHS_SHORT[euNoYearMatch[2].toLowerCase().slice(0, 3)];
      if (mi !== undefined) {
        day = parseInt(euNoYearMatch[1]);
        month = mi;
        year = new Date().getFullYear();
      }
    }
  }

  // Named month with day, no year: "March 21" / "Mar 21"
  if (month === undefined) {
    const noYear = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/;
    const noYearMatch = s.match(noYear);
    if (noYearMatch) {
      const mi = MONTHS_SHORT[noYearMatch[1].toLowerCase().slice(0, 3)];
      if (mi !== undefined) {
        month = mi;
        day = parseInt(noYearMatch[2]);
        year = new Date().getFullYear();
      }
    }
  }

  // Validate parsed values
  if (month === undefined || day === undefined || year === undefined) return null;
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;

  // Extra validation: ensure the date is real (e.g., Feb 30 is invalid)
  const dateObj = new Date(year, month, day);
  if (dateObj.getMonth() !== month || dateObj.getDate() !== day) return null;

  return `${MONTHS_LONG[month]} ${day}${getOrdinalSuffix(day)}, ${year}`;
}

/**
 * Resolve relative date keywords and common date formats to Roam date format.
 * Returns the original string if not a recognized date pattern.
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
      return normalizeToRoamDate(input) ?? input;
  }
}
