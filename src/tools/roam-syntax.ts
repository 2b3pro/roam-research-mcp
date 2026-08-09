/**
 * ROAM_SYNTAX — the data-safety and syntax rules an agent needs before its
 * first write, returned by `roam_get_guidelines` as the `roamSyntax` field.
 *
 * WHY IT LIVES ON THE GUIDELINES RESULT. Every write tool's description already
 * says "load the Roam Markdown Cheatsheet", but that is a second, voluntary
 * tool call, and a model under budget pressure skips it. The guidelines call is
 * the one we successfully insist on. Anything that must reach every client —
 * including clients with no skill installed and no cheatsheet fetch — has to
 * ride on a response the agent already asked for.
 *
 * SCOPE. This is not the cheatsheet. `Roam_Markdown_Cheatsheet.md` is the
 * complete syntax reference (components, queries, embeds, CSS tags) and stays
 * the place to look things up. This blob is only the subset where being wrong
 * DESTROYS something — content, references, or the user's trust in the graph —
 * and it stays short enough that its cost is never the reason to skip it.
 *
 * ORDERING IS DELIBERATE. Sections run in descending order of how much damage
 * getting them wrong does, not in taxonomic order, and the closing line repeats
 * the destructive cases. Models attend hardest to the beginning and end of a
 * blob, so the irreversible things occupy both.
 *
 * LAYERING. The user's own `[[roam/agent guidelines]]` page governs style and
 * convention and can override anything about voice, tagging, or placement. It
 * cannot override the facts below: no convention makes a truncated preview
 * complete, or brings back a block that a whole-page rewrite deleted.
 *
 * PRIOR ART. The idea of returning a compact syntax blob from the guidelines
 * call, the damage-ranked ordering, and the closing checksum are borrowed from
 * Roam Research's own MCP server (`@roam-research/roam-mcp`, the `roamSyntax`
 * field of its `get_graph_guidelines`, added 2026-08). That project publishes
 * no licence, so nothing here is copied from it: the text below is written for
 * this server's tools and describes this server's failure modes, which are not
 * the same ones — it talks to Roam's backend REST API, not Roam Desktop, and
 * has no `<roam/>` wire format to teach.
 *
 * WHEN EDITING: this is the canonical home for the load-bearing warnings. If a
 * fact here also appears in the cheatsheet, change it here first;
 * `roam-syntax.test.ts` pins the invariants that must not quietly disappear.
 */

/**
 * The blob itself. Assembled from an array so each section is independently
 * readable in source and the joins can't drift.
 */
export const ROAM_SYNTAX = [
  'ROAM DATA SAFETY — read before writing. Roam is an outliner, its markdown is not standard markdown, and it has no undo for API writes. The graph guidelines above govern style and convention; the rules below govern data integrity and hold regardless of them.',
  '',
  'DESTRUCTIVE: WHOLE-PAGE REWRITES DELETE. `roam_update_page_markdown` diffs the markdown you pass against the ENTIRE existing page and deletes every block your markdown does not account for. It is not an append. Pass the complete intended page, or use `roam_process_batch_actions` / `roam_create_outline` to touch only what you mean to touch. Use `dry_run: true` first when unsure — it returns the actions without applying them.',
  '',
  'DESTRUCTIVE: PREVIEWS ARE NOT CONTENT. `roam_fetch_page_by_title` with `format: "structure"` cuts each block at 80 characters and marks the entry `truncated: true`. That text is for orientation only. Writing it back replaces the block with its own opening fragment. Re-read the block with `roam_fetch_block` before editing any text you got from a preview.',
  '',
  'DESTRUCTIVE: REFERENCES ARE LIVE — DO NOT RETYPE THEM. `((block-uid))` renders the referenced block; replacing it with the text it displayed turns a live reference into a stale copy, and the link is not recoverable from the result. Preserve `((uid))` spans exactly as read, and never invent a uid — use only uids a tool actually returned to you.',
  '',
  'YOUR READS ARE INCOMPLETE. Blocks tagged `#.rm-hide` or `#.rm-private`, and everything nested under them, are withheld from every read tool, and nothing in the output marks the gap — a page can look complete when it is not. This will not destroy anything: those subtrees are excluded from the `roam_update_page_markdown` diff too, so a rewrite leaves them alone (it reports `preserved_hidden` when it does). But do not claim a page contains only what you were shown, and be careful answering "is X here?" — you cannot tell absence from concealment.',
  '',
  'FORMATTING (differs from standard markdown). Italics is `__text__`; bold is `**text**` — the two are swapped relative to standard markdown, so `__x__` written as bold silently renders italic. Highlight `^^text^^`, strikethrough `~~text~~`. A task is `{{[[TODO]]}}` at the START of the block, never `- [ ]`, or it will not toggle. Headings are `#`/`##`/`###` only, H1–H3. Nest by indenting: a heading does not pull the blocks after it underneath itself.',
  '',
  'LINKS MINT PAGES. `[[Name]]` and `#Name` both create the page if it does not exist, so link deliberately rather than bracketing every noun. Multi-word tags need brackets: `#[[two words]]`, not `#twowords`. Because `#` always makes a page, a bare `#1` creates a page named "1" — write `Step 1` or quote it. Dates are ordinal page names: `[[January 3rd, 2026]]`.',
  '',
  'ATTRIBUTES. `Key:: value` at the start of a block creates a queryable attribute. Roam bolds the key itself, so write `Type:: Book`, never `**Type**:: Book`. Use `::` only for values you would query across the graph; otherwise write a bold label.',
  '',
  'ESCAPING. Markup you write goes live immediately. When your text DOCUMENTS syntax rather than using it, wrap it in backticks — an unescaped `[[example]]` in a note about linking creates a real page and a real backlink. This is how an agent quietly pollutes a graph.',
  '',
  'BEFORE EVERY WRITE: is this a whole-page rewrite that will delete what I did not include; did I get this text from a truncated preview; am I retyping a `((uid))` reference instead of preserving it; is the syntax I am documenting inside backticks?',
].join('\n');
