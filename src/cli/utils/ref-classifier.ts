/**
 * Classify a `roam save --page` reference by what its shape can actually
 * establish. Pure: no graph access. (`--parent` is always text and is not
 * classified; `--parent-uid` is parsed by `parseUidFlag` below.)
 *
 * This replaces a heuristic that required a digit before believing a value was
 * a UID. About one block UID in five has no digit, so a wrapped UID silently
 * became text for those. Shape alone cannot tell a bare
 * 9-character UID from a 9-character title like "Learnings"; that case is
 * reported as `ambiguous` and the caller asks the graph.
 */

const UID_SHAPE = /^[a-zA-Z0-9_-]{9}$/;
const WRAPPED = /^\(\((.*)\)\)$/s;

export type RefClass =
  /** Wrapped in (( )) and UID-shaped: an explicit block reference. */
  | { kind: 'uid'; uid: string }
  /** Bare and UID-shaped: a UID or a 9-character title. Only the graph knows. */
  | { kind: 'ambiguous'; value: string }
  /** Anything else: heading text or a page title, used exactly as given. */
  | { kind: 'text'; value: string };

export function classifyRef(raw: string): RefClass {
  const inner = raw.match(WRAPPED)?.[1];
  if (inner !== undefined && UID_SHAPE.test(inner)) {
    return { kind: 'uid', uid: inner };
  }
  if (UID_SHAPE.test(raw)) {
    return { kind: 'ambiguous', value: raw };
  }
  return { kind: 'text', value: raw };
}

/**
 * Parse the value of `--parent-uid`, which is never text. Accepts `uid` or
 * `((uid))`; throws on anything else.
 */
export function parseUidFlag(raw: string): string {
  const candidate = raw.match(WRAPPED)?.[1] ?? raw;
  if (!UID_SHAPE.test(candidate)) {
    throw new Error(
      `--parent-uid expects a 9-character block UID (uid or "((uid))"), got "${raw}". ` +
      `To nest under a block by its text, use --parent.`
    );
  }
  return candidate;
}
