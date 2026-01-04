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
