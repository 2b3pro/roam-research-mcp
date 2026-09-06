/**
 * Encoding a Roam block string so it occupies exactly one line of markdown.
 *
 * A Roam block may contain a newline — a soft line break (Shift+Enter). Our
 * markdown renderers emit one `- ` line per block, so an unescaped newline
 * spills onto a second physical line with no bullet and no indentation. The
 * parser then reads it as a separate block AT ROOT LEVEL, which resets the
 * indentation baseline and reparents everything after it. A single soft line
 * break flattens the rest of the page.
 *
 * Keeping each block on one line is therefore not cosmetic: it is what makes
 * the round trip preserve hierarchy at all.
 *
 * A soft break is rendered as a single sentinel character, U+23CE `⏎`, rather
 * than a backslash escape. Two earlier revisions used `\n` (with backslash
 * doubling to disambiguate a literal backslash-n); both corrupted ordinary
 * content, because `\n` is a common PREFIX in authored text — LaTeX commands
 * (`\nabla`, `\neq`) and Windows paths (`C:\new…`) all begin with it, so
 * decoding `\n` anywhere corrupted them. `⏎` essentially never occurs in
 * authored text, so decoding it is safe even for blocks the agent wrote
 * itself. No backslash rules exist at all any more.
 *
 * See `docs/multiline-block-roundtrip-spec.md`.
 */

/**
 * The single-line stand-in for a soft line break: U+23CE RETURN SYMBOL.
 *
 * Revision 2 used `\n` escapes with backslash doubling. That failed twice:
 * `\n` is a common PREFIX in ordinary content (`\nabla`, `\neq`, `C:\new…`),
 * so decoding it anywhere an agent may have authored text corrupted LaTeX and
 * Windows paths — even the marker could not make it safe per-block. `⏎`
 * essentially never occurs in authored text, so decoding it inside a marked
 * payload is safe INCLUDING for blocks the agent wrote. No backslash rules
 * exist at all any more.
 *
 * The accepted corner: a block genuinely containing a literal `⏎` round-trips
 * it into a newline. Content-level, degrades to a soft break, documented, and
 * pinned by a test so it stays a choice rather than an accident.
 */
export const SOFT_BREAK_SENTINEL = '⏎';

/** Render a block string as a single line. Identity for newline-free text. */
export function escapeBlockString(text: string): string {
  return text.includes('\n') ? text.replace(/\n/g, SOFT_BREAK_SENTINEL) : text;
}

/** Restore soft line breaks. Call ONLY on marker-carrying payloads. */
export function unescapeBlockString(text: string): string {
  return text.includes(SOFT_BREAK_SENTINEL)
    ? text.replace(/⏎/g, '\n')
    : text;
}

/**
 * Marks a rendered payload whose block strings were escaped.
 *
 * Revision 1 decoded `\n` unconditionally, which corrupted every LaTeX command
 * and Windows path that begins `\n` — `$$\nabla f$$` became `$$<newline>abla
 * f$$`. An escape sequence built from characters that occur in ordinary content
 * can only be decoded where the ENCODER is known to have run. This marker is
 * how the decoder knows.
 *
 * An HTML comment on purpose: inert everywhere, and harmless if it ever lands
 * in a block by accident.
 */
export const ESCAPED_NEWLINES_MARKER = '<!-- roam:escaped-newlines -->';

/**
 * Does this page need escaping at all?
 *
 * Escaping is conditional so a page with no multi-line block renders exactly
 * as it did before any of this work — no marker, no backslash doubling. That
 * is the overwhelming majority of pages, and it keeps the blast radius of the
 * encoding near zero.
 */
export function needsNewlineEscaping(blockStrings: readonly string[]): boolean {
  return blockStrings.some((s) => s.includes('\n'));
}
