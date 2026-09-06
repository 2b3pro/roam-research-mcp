# Roam Markdown Cheatsheet v2.8.0

## Core Syntax

### Formatting
`**bold**` · `__italic__` · `^^highlight^^` · `~~strike~~` · `` `code` `` · `$$LaTeX$$`

⚠️ `*italic*` and `_italic_` are normalized to `__italic__` by the markdown tools, but `roam_process_batch_actions` writes strings literally and Roam does not render single markers. Write `__italic__` everywhere so reads and writes agree.

### Headings
`# H1` · `## H2` · `### H3` at the start of a block. Roam has H1–H3 only; `####` and deeper are not headings and stay literal text. A heading is a property of its own block: it does not nest the blocks after it. Indent to nest.

### Links & References
- **Page ref:** `[[Page Name]]` — creates/links to page
- **Block ref:** `((block-uid))` — embeds block content inline
- **Block embed:** `{{[[embed]]: ((block-uid))}}` — full block with children
- **Embed children:** `{{[[embed-children]]: ((block-uid))}}` — children only (not the parent block)
- **Embed path:** `{{[[embed-path]]: ((block-uid))}}` — block with its ancestor path
- **Page embed:** `{{[[embed]]: [[Page Name]]}}` — the whole page inline
- **External:** `[text](URL)`
- **Aliased page:** `[display text]([[Actual Page]])`
- **Aliased block:** `[display text](<((block-uid))>)` — note the angle brackets
- **Image:** `![alt](URL)`

### Tags
- Single word: `#tag`
- Multi-word: `#[[multiple words]]`
- Hyphenated: `#self-esteem`

⚠️ Never concatenate: `#knowledgemanagement` ≠ `#[[knowledge management]]`
⚠️ `#` always creates tags — write `Step 1` not `#1`
⚠️ Because `#` creates tags, a bare `#N` silently creates a numbered page. When you must show the literal form, put it in quotes: `"#1"`, `"#2"` — otherwise rephrase (`Step 1`, `No. 1`, `item 1`)

### Dates
Always ordinal format: `[[January 1st, 2025]]`, `[[December 23rd, 2024]]`

### Tasks
- Todo: `{{[[TODO]]}} task`
- Done: `{{[[DONE]]}} task`

⚠️ `{{[[TODO]]}}` must lead the block. Anywhere else it renders a checkbox that does not toggle to DONE.

### Callouts
Styled blockquotes with an icon and colour. Two page refs open the block: `[[>]]` marks it a callout, `[[!TYPE]]` picks the style.

```
[[>]] [[!TIP]] Title text
Body on the next line
```

The body is a **soft line break inside the same block** (Shift+Enter in the UI, `\n` in the block string) — not a child block. A child block renders as a nested bullet inside the callout instead, which is usually not what you want.

Types: `NOTE` `INFO` `SUMMARY` `TIP` `SUCCESS` `QUESTION` `WARNING` `FAILURE` `DANGER` `BUG` `EXAMPLE` `QUOTE`

Append `+` or `-` to make it foldable — `[[!TIP]]+` starts expanded, `[[!TIP]]-` starts collapsed.

⚠️ `[[>]]` and `[[!TIP]]` are real page references, so every callout backlinks to those pages. That is normal and how the feature works — don't "clean it up."
⚠️ A plain `> quote` is an ordinary blockquote, not a callout. The two are unrelated.

### Soft line breaks

A block can hold more than one line — a **soft line break** (Shift+Enter in the
UI). It stays *one* block, which is what callout bodies and fenced code blocks
rely on.

**You cannot write one through the markdown tools.** `roam_create_page`,
`roam_import_markdown`, `roam_create_outline` and `roam_update_page_markdown`
all treat a line break as a block break. Use `roam_process_batch_actions`, which
writes block strings literally — put a real newline in the `string`.

The one exception: inside a payload carrying the `<!-- roam:escaped-newlines -->`
marker (below), a `⏎` decodes to a real soft line break on write. So keeping —
or adding — a `⏎` in a marker-carrying payload handed to
`roam_update_page_markdown` *is* the one markdown-tools path that writes one.
Without the marker, `⏎` is just the character; it does not decode.

⚠️ Reads render a soft line break as `⏎` so the block stays on one line, and a
payload containing any is marked with a leading `<!-- roam:escaped-newlines -->`
comment. If you edit that markdown and pass it back to
`roam_update_page_markdown`, **keep the marker line** — it is what tells the
server `⏎` means a line break there. Content you add yourself is safe either
way: backslashes are never special, and `$$\nabla f$$` or `C:\newdir` are
written exactly as typed.

### Attributes
```
Type:: Book
Author:: [[Person Name]]
Rating:: 4/5
```

**Use `::` when:** queryable across graph (Type, Author, Status, Source, Date)
**Use bold instead when:** page-specific labels (Step 1, Summary, Note)

⚠️ Test: "Will I query all blocks with this attribute?" If no → use `**Label:**` instead
⚠️ Never `**Attr**::` — Roam auto-bolds attributes

## Block Structures

### Bullets
```
- Parent
    - Child
        - Grandchild
```

### Numbered & document lists
A numbered list is a **view type on the parent**, not `1.` markers in the text. Set `children-view-type: "numbered"` (or `"document"` for no bullets) on the parent through `roam_process_batch_actions` (`create-block` / `update-block`) or a `roam_create_page` content item. `1.` markers written into block text stay literal.

### Code Blocks
````
```javascript
const x = 1;
```
````

⚠️ Through `roam_process_batch_actions` (literal), do not leave a trailing newline before the closing fence. Roam stores it verbatim and renders it wrong. The markdown tools normalize it away.

### Queries
```
{{[[query]]: {and: [[tag1]] [[tag2]]}}}
{{[[query]]: {or: [[A]] [[B]]}}}
{{[[query]]: {not: [[exclude]]}}}
{{[[query]]: {between: [[January 1st, 2025]] [[January 31st, 2025]]}}}
{{[[query]]: {and: [[Project]] {search: mobile}}}}
```

Clauses nest: `{and: [[Project]] {not: [[DONE]]}}`.

**Queries match REFERENCES, not text.** Operands must be `[[Page]]` or `((block-uid))` — bare or quoted words do not match. `{and: TODO}` and `{and: "project alpha"}` both find nothing; write `{and: [[TODO]]}` and `{and: [[project alpha]]}`. For free text use `roam_search_by_text`, or a `{search:}` clause.

**`{search:}` only works nested inside `{and:}` or `{or:}`** — never on its own, and it is the one clause that takes plain text rather than a reference.

**`{between:}` only works on Daily Notes pages.** It filters by the daily page a block lives on, so it does nothing for content on ordinary pages. It accepts shorthands: `[[today]]`, `[[yesterday]]`, `[[last week]]`, `[[next month]]`.

Also available: `{created-by: [[User]]}`, `{edited-by: [[User]]}`, `{by: [[User]]}`.

#### Page-ref inheritance — the non-obvious one
**A block inherits its parent's page refs for query matching.** So this TODO matches `{and: [[TODO]] [[Project Alpha]]}` even though it contains no reference to Project Alpha:

```
- Notes on [[Project Alpha]]
    - {{[[TODO]]}} Ship the thing
```

Three consequences:
- **Don't tag every child with the parent's ref** — it is already inherited, and the duplication just clutters the backlinks.
- **Do tag a child explicitly** if you want it to match *independently* of where it sits. Move it later and inherited matching goes with the old parent.
- **Reading results:** a returned block may not visibly contain the thing you queried for. The matching ref can be on an ancestor. Don't report the result as wrong, and don't "fix" the block by adding the tag.

### Calculator
`{{[[calc]]: 2 + 2}}`

### Codeblock
Roam uses "shell" not "bash". Other common languages okay, including "plain text".
```shell
echo "Hello world!"
```


## Complex Structures

### Tables
Each column nests ONE LEVEL DEEPER than previous:
```
{{[[table]]}}
    - Header 1
        - Header 2
            - Header 3
    - Row 1 Label
        - Cell 1.1
            - Cell 1.2
    - Row 2 Label
        - Cell 2.1
            - Cell 2.2
```
Keep tables ≤5 columns.

### Kanban
```
{{[[kanban]]}}
    - Column 1
        - Card 1
        - Card 2
    - Column 2
        - Card 3
```

### Mermaid
Diagram definition via nested bullets or a code block child:
```
{{[[mermaid]]}}
    - graph TD
        - A[Start] --> B{Decision}
        - B -->|Yes| C[Action]
```
Per-diagram theme: first child line `%%{init: {"theme":"forest"}}%%`. Graph-wide via CSS: `:root { --mermaidjs-theme: dark; }` (in `roam/css`)

### Hiccup
`:hiccup [:iframe {:width "600" :height "400" :src "URL"}]`

## Advanced Components

Write the `{{[[name]]: arg}}` form. The `/name` slash commands are UI-only and do nothing in a written block string.

### Dropdowns & Tooltips
- **Dropdown:** `{{or: option A|option B|option C}}` — select from options, display chosen one
- **Tooltip:** `{{=:text|hidden content}}` — click to reveal/hide content

### Templates
- **Template button:** `{{x-template-button: ((roam/template block ref))}}` — inserts template on click
- **Daily template:** `{{x-daily-template: ((roam/template block ref))}}` — adds `+` button on empty daily notes

### Advanced Queries
- **Datalog block query:** `{{datalog-block-query: [:find ?b :where [?b :block/string "text"]]}}` — renders results like native queries
- **Datalog table:** `:q [:find ?title :where [?p :node/title ?title]]` — renders results in sortable table
  - Supports column transforms, date arithmetic, resizable columns, pagination
  - `:q` extensions, usable **only inside a `:q` block in the graph**: date symbols `ms/today-start`, `ms/this-week-start`, `ms/+1D-start`, `dnp/today`, `dnp/-1D` (a daily-page title), `current/page-title`; inbuilt rules `(created-by ?user ?b)`, `(edited-by ?user ?b)`, `(by ?user ?b)`, `(refs-page ?title ?b)`, `(block-or-parent-refs-page ?title ?b)`, `(created-between ?t1 ?t2 ?b)`, `(edited-between ?t1 ?t2 ?b)`, `(in-dnp ?dnp ?b)`, `(refs-dnp ?dnp ?b)`, `(in-dnp-between ?start ?end ?b)`

#### `roam_datomic_query` runs plain DataScript only
⚠️ The `:q` extensions above do **not** work through `roam_datomic_query`. A rule such as `(refs-page "X" ?b)` fails with `Missing rules var '%'`. Write the raw clauses instead, `[?p :node/title "X"] [?b :block/refs ?p]`, and use epoch-millisecond literals for time bounds.

**Schema** (what `:where` clauses match):
- Pages: `:node/title`
- Blocks: `:block/string` (raw stored text), `:block/uid`, `:block/order`, `:block/page`, `:block/children` (immediate), `:block/parents` (all ancestors), `:block/refs` (outgoing), `:block/heading` (1–3), `:children/view-type`
- Both: `:create/time`, `:edit/time` (epoch ms); `:create/user`, `:edit/user` point at a user entity with `:user/uid` (every user) and `:user/display-page`

Three gotchas:
- **`:user/email` exists only on human users.** API-token and AI writers have none, so a join on `:user/email` silently drops their blocks. Match on `:user/uid`.
- **Results are unordered.** Sort client-side; `:create/time` descending for newest-first.
- **Recursive child pulls cap at 1000 per level** unless written `{[:block/children :limit nil] ...}`. `[*]` alone is immediate children only.

```clojure
;; blocks referencing a page (the portable form of refs-page)
[:find ?uid :where [?p :node/title "Project Alpha"] [?b :block/refs ?p] [?b :block/uid ?uid]]

;; a page and its full block tree, uncapped
[:find (pull ?e [* {[:block/children :limit nil] ...}]) :where [?e :node/title "Page Name"]]
```

### Document Mode
`:document` — opens inline WYSIWYG text editor in the block

### Utility Components
- `{{orphans}}` — shows orphaned blocks
- `{{iframe: URL}}` — embeds web page (simpler than hiccup)
- `{{word-count}}` — displays word count for the block
- `{{chart: ATTR_PAGE_TO_CHART}}` — chart component
- `{{a}}` — anonymous slider (shared graphs)
- `{{[[video]]: URL}}` — YouTube / Vimeo / Loom
- `{{[[mentions]]: [[Page]]}}` — inline a page's linked and unlinked references
- `{{date}}` — date picker that inserts a date-page ref
- `{{[[slider]]}}` — inline rating control, e.g. `certainty:: {{[[slider]]}}`
- `{{[[streak]]: [[Goal]]}}` — heatmap of how often a ref appears in daily notes
- `{{roam/render: ((codeUid))}}` — render a referenced code block as a component
- `{{[[roam/css]]}}` — a child fenced `css` block applies graph-wide styling
- `{{diagram: Title}}` — 2D canvas; each node is a real block
- `{{encrypt}}` — write it bare; Roam converts it once the user supplies content and a password

### CSS Tags
- `#.classname` — applies CSS class `.classname` to the block
- Native style tags:

| Tag | Effect |
|-----|--------|
| `#.rm-E` | Display children horizontally |
| `#.rm-g` | Promote children up a level; `[[.rm-g]]` keeps the container visible |
| `#.rm-hide` | Collapse to a clickable bar in the UI; **withheld from every AI read** |
| `#.rm-private` | Roam's hidden-from-other-users tag; **also withheld from every AI read** |
| `#.rm-hide-for-readers` | Hide block for read-only users |

⚠️ `#.rm-hide` and `#.rm-private` remove the block **and its whole subtree** from what the read tools return, with no marker in the output. A page can look complete when it is not.

## Anti-Patterns

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `#multiplewords` | `#[[multiple words]]` |
| `#1`, `#2` | `Step 1`, `No. 1`, or quoted: `"#1"` |
| `[[january 1, 2025]]` | `[[January 1st, 2025]]` |
| `[text](((uid)))` | `[text](<((uid))>)` |
| `{{embed: ((uid))}}` | `{{[[embed]]: ((uid))}}` |
| `[[TODO]] task` | `{{[[TODO]]}} task` |
| `- *bullet` | `- bullet` |
| `* bullet` | `- bullet` |
| `**Attr**:: val` | `Attr:: val` |
| `{and: TODO}` | `{and: [[TODO]]}` (queries match refs, not words) |
| `{and: "project alpha"}` | `{and: [[project alpha]]}` |
| `{{[[query]]: {search: text}}}` | `{{[[query]]: {and: {search: text}}}}` (never standalone) |
| `> [[!TIP]] Title` | `[[>]] [[!TIP]] Title` |
| callout body as a child block | body as `\n` in the same block |
| `*italic*` in batch actions | `__italic__` |
| `#### Heading` | `### Heading` (H1–H3 only) |
| `1. item` as a numbered list | `children-view-type: "numbered"` on the parent |
| `- [ ] task` | `{{[[TODO]]}} task` |
| `(refs-page "X" ?b)` in `roam_datomic_query` | `[?p :node/title "X"] [?b :block/refs ?p]` |

## Tool Selection

```
CREATING:
├─ New page + structure → roam_create_page
├─ Add to existing page/block:
│   ├─ Simple outline → roam_create_outline
│   └─ Complex markdown → roam_import_markdown
├─ Revise entire page → roam_update_page_markdown
├─ Fine-grained CRUD → roam_process_batch_actions
├─ Table → roam_create_table
├─ Memory → roam_remember
└─ Todos → roam_add_todo

NESTING (roam_import_markdown): nests by BOTH indentation AND markdown heading
level — content and deeper headings fold under their heading (## under #, ### under
##). Use it for heading-structured docs. roam_create_page nests ONLY by explicit
per-item `level` integers, so heading-structured markdown sent to create_page
imports flat. Don't use `---` dividers; they become horizontal-rule blocks.

SEARCHING:
├─ By tag → roam_search_for_tag
├─ By text → roam_search_by_text
├─ By date → roam_search_by_date
├─ By status → roam_search_by_status
├─ Block refs → roam_search_block_refs
├─ Modified today → roam_find_pages_modified_today
├─ Page content → roam_fetch_page_by_title
├─ Block (children/ancestors) → roam_fetch_block
├─ Memories → roam_recall
└─ Complex → roam_datomic_query
```

## API Efficiency

**Ranking (best → worst):**
1. `roam_update_page_markdown` — single call: fetch + diff + update
2. `roam_process_batch_actions` — batch multiple ops
3. `roam_create_page` — batches content with creation
4. `roam_create_outline` / `roam_import_markdown` — includes verification
5. Multiple sequential calls — avoid

**Best practices:**
- Use `roam_update_page_markdown` for revisions (handles everything)
- For 10+ blocks: `roam_process_batch_actions`
- Cache UIDs — use `page_uid` over `page_title` when available
- Never fetch-modify-fetch-modify in loops

### UID Placeholders
Use `{{uid:name}}` for parent refs in batch actions:
```json
[
  {"action": "create-block", "uid": "{{uid:parent}}", "string": "Parent", "location": {"parent-uid": "pageUid", "order": 0}},
  {"action": "create-block", "string": "Child", "location": {"parent-uid": "{{uid:parent}}", "order": 0}}
]
```
Server returns `{"uid_map": {"parent": "Xk7mN2pQ9"}}`.

⚠️ `delete-block` breaks every `((uid))` that pointed at the block, and Roam has no undo for API writes. Check `roam_search_block_refs` before deleting a block others may reference.

## Structural Defaults

- **Hierarchy:** 2-4 levels preferred, rarely exceed 5
- **Blocks:** One idea per block
- **Embed vs ref:** `((uid))` inline, `{{[[embed]]: ((uid))}}` with children, `{{[[embed-children]]: ((uid))}}` children only, `{{[[embed-path]]: ((uid))}}` with ancestors, `[text](<((uid))>)` link only
- **No empty blocks** — use hierarchy for visual separation
- **Never invent a `((uid))`:** use only uids a tool actually returned. A fabricated ref is a broken link.

## Conventions

This cheatsheet is syntax only. How to tag, when to use a page ref versus a hashtag, and the shape of a quote, definition, TODO, or footnote are conventions, and they belong to the graph's `[[roam/agent guidelines]]` page (returned by `roam_get_guidelines`) and the personalization layer appended below. Where a convention and this sheet appear to disagree, the convention wins on style; this sheet wins on what Roam will actually render.

---
