# Roam Markdown Cheatsheet v2.1.0

## Core Syntax

### Formatting
`**bold**` · `__italic__` · `^^highlight^^` · `~~strike~~` · `` `code` `` · `$$LaTeX$$`

### Links & References
- **Page ref:** `[[Page Name]]` — creates/links to page
- **Block ref:** `((block-uid))` — embeds block content inline
- **Block embed:** `{{[[embed]]: ((block-uid))}}` — full block with children
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

### Dates
Always ordinal format: `[[January 1st, 2025]]`, `[[December 23rd, 2024]]`

### Tasks
- Todo: `{{[[TODO]]}} task`
- Done: `{{[[DONE]]}} task`

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

### Code Blocks
````
```javascript
const x = 1;
```
````

### Queries
```
{{[[query]]: {and: [[tag1]] [[tag2]]}}}
{{[[query]]: {or: [[A]] [[B]]}}}
{{[[query]]: {not: [[exclude]]}}}
{{[[query]]: {between: [[January 1st, 2025]] [[January 31st, 2025]]}}}
```

### Calculator
`{{[[calc]]: 2 + 2}}`

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
```
{{[[mermaid]]}}
    - graph TD
        - A[Start] --> B{Decision}
        - B -->|Yes| C[Action]
```

### Hiccup
`:hiccup [:iframe {:width "600" :height "400" :src "URL"}]`

## Anti-Patterns

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `#multiplewords` | `#[[multiple words]]` |
| `#1`, `#2` | `Step 1`, `No. 1` |
| `[[january 1, 2025]]` | `[[January 1st, 2025]]` |
| `[text](((uid)))` | `[text](<((uid))>)` |
| `{{embed: ((uid))}}` | `{{[[embed]]: ((uid))}}` |
| `[[TODO]] task` | `{{[[TODO]]}} task` |
| `- *bullet` | `- bullet` |
| `* bullet` | `- bullet` |
| `**Attr**:: val` | `Attr:: val` |

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

SEARCHING:
├─ By tag → roam_search_for_tag
├─ By text → roam_search_by_text
├─ By date → roam_search_by_date
├─ By status → roam_search_by_status
├─ Block refs → roam_search_block_refs
├─ Modified today → roam_find_pages_modified_today
├─ Page content → roam_fetch_page_by_title
├─ Block + children → roam_fetch_block_with_children
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

## Structural Defaults

- **Hierarchy:** 2-4 levels preferred, rarely exceed 5
- **Blocks:** One idea per block
- **Page refs vs tags:** `[[Page]]` for expandable concepts, `#tag` for filtering
- **Embed vs ref:** `((uid))` inline, `{{[[embed]]: ((uid))}}` with children, `[text](<((uid))>)` link only
- **No empty blocks or `---` dividers** — use hierarchy for visual separation

## Output Conventions

**Quote:** `<text> —[[Author]] #quote`
**Definition:** `Term:: definition #definition`
**Open question:** `{{[[TODO]]}} Research: <question> #[[open questions]]`

---
