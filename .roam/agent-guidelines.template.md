# Template — `[[roam/agent guidelines]]`

A starting point for the page that tells AI agents how *your* graph works.

## Status

> Read by the `roam_get_guidelines` tool with no configuration needed — just
> create the page. Roam's own MCP server reads the same title, so one page
> serves both.
>
> To point a graph at a different page set `guidelinesPage` on it in
> `ROAM_GRAPHS`; to turn it off for a graph set `guidelinesPage: false`.

## Why a page instead of a file

`CUSTOM_INSTRUCTIONS_PATH` points at a file on disk: one set of instructions for
every graph, and the server caches it — editing the file does nothing until the
server restarts. A guidelines **page** is per-graph, editable from inside Roam,
and takes effect immediately. Because it is a shared convention, one page serves
every agent that knows to look for it.

Keep the content **server-agnostic**: your conventions, not tool names. Anything
about `roam_process_batch_actions` or `{{uid:name}}` belongs in the cheatsheet,
not here — this page may be read by an agent connected through a different
server entirely.

## How to use this

1. Create a page titled `roam/agent guidelines`.
2. Copy the outline below, keeping the nesting.
3. **Replace every `<placeholder>` and delete any line you don't fill in.** An
   unfilled placeholder is worse than a missing section — the agent will read
   `<your convention here>` as an instruction.
4. Delete whole sections that don't apply. A short page you actually follow
   beats a long one you don't.

Indentation maps 1:1 to Roam block nesting. `H2:` / `H3:` mark blocks that should
carry Roam heading formatting.

## Three traps, learned the hard way

**Backtick every example.** This page is a real Roam page, so an example written
plainly becomes a real reference. `[[Some Page]]` without backticks links this
page into `Some Page`'s linked references; `#[[some tag]]` tags this page. A
guidelines page full of unescaped examples quietly pollutes dozens of pages.
Write `` `[[Some Page]]` `` instead.

**Never start a block with `Key:: value`** unless you want a live attribute on
this page. `Type:: Book` at the start of a block creates a real `Type` attribute.
Backtick it: `` `Type:: Book` ``.

**Don't use `---` separators.** They render as literal blocks, not rules.

---

## The outline

- H2: Graph-Level Behaviors
    - H3: On Creating New Pages
        - `<what should happen when a page is created — daily-note breadcrumb, required attributes, naming pattern>`
    - H3: On Adding Content
        - Default location for quick captures: `<e.g. the daily page>`
        - Long-form content: `<e.g. dedicated page, linked from the daily page>`

- H2: Tagging Philosophy
    - H3: Core Principle
        - `<one sentence on what tags are FOR in your graph — retrieval? categorization? unexpected connections?>`
    - H3: What To Tag
        - `<the question you ask before tagging>`
            - `<what that implies>`
    - H3: Tag Type Selection
        - `[[Page Reference]]` — `<when a concept deserves its own page>`
        - `#[[hashtag]]` — `<when it's categorization only>`
        - `#single-word` — `<when it's simple and unambiguous>`
        - `Type::` attribute — `<when it's structured metadata for queries>`
    - H3: Vocabulary
        - `<list the tags you actually want reused, so the agent picks from them instead of inventing new ones>`

- H2: Formatting Conventions
    - H3: `<content type, e.g. Quotes>`
        - Format: `<the exact shape you want, in backticks>`
    - H3: TODOs and Follow-ups
        - `{{[[TODO]]}} <action needed>`
    - H3: Dates and Scheduling
        - `<how you want dates written and what a dated block means>`

- H2: Constraints & Guardrails
    - H3: DON'T
        - `<the mistake you keep having to correct>`
    - H3: DO
        - `<the habit you want reinforced>`

- H2: Page Patterns
    - H3: `<page type, e.g. Books>`
        - Title: `<title pattern, e.g. [[Book/<title> | <author>]]>`
        - Attributes: `<e.g. Type:: Book, Status:: Reading>`

## Optional sections

Add these only if you'll fill them in:

- **Integration Notes** — how Roam relates to your other tools (what flows in,
  what flows out, when you review).
- **Endnotes & Footnotes** — if you have a specific footnote convention.
- **Aliasing rules** — if capitalization or display text matters to you.
