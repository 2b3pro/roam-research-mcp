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
 * See `docs/multiline-block-roundtrip-spec.md`.
 */

/**
 * Render a block string as a single line.
 *
 * ORDER IS THE CORRECTNESS ARGUMENT. The backslash is escaped first; doing
 * newlines first would encode both a real newline and a literal backslash-n
 * as `\n`, and they could not be told apart on the way back.
 */
export function escapeBlockString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

/**
 * Restore a block string from its single-line form.
 *
 * Deliberately not a pair of regex replaces: `.replace(/\\n/g,'\n')` followed
 * by `.replace(/\\\\/g,'\\')` re-examines its own output and turns the encoded
 * form of a literal backslash-n into a real newline. This scans once,
 * left to right, consuming each escape together with its successor and never
 * looking at what it has already emitted.
 *
 * Built with slice + join rather than `+=` in a character loop — the same
 * shape that makes the end-of-string case obvious: a trailing lone backslash
 * has no successor to consume and must survive as itself.
 */
export function unescapeBlockString(text: string): string {
  const first = text.indexOf('\\');
  if (first === -1) return text; // the overwhelmingly common case

  const parts: string[] = [];
  let last = 0;

  for (let i = first; i < text.length; i++) {
    if (text.charCodeAt(i) !== 92 /* backslash */) continue;

    const next = text[i + 1];
    if (next === 'n') {
      parts.push(text.slice(last, i), '\n');
    } else if (next === '\\') {
      parts.push(text.slice(last, i), '\\');
    } else {
      // Not an escape we emit (or a trailing lone backslash). Leave it, and
      // do not consume a successor that may itself start a real escape.
      continue;
    }
    last = i + 2;
    i++; // skip the successor we just consumed
  }

  parts.push(text.slice(last));
  return parts.join('');
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
