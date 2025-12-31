# Roam Markdown Cheatsheet — Generic Foundation v2.0.0

> ⚠️ **MODEL DIRECTIVE**: Always consult this cheatsheet BEFORE making any Roam tool calls. Syntax errors in Roam are unforgiving.

---

## Quick Reference: Core Syntax

### Text Formatting
| Style | Syntax | Example |
|-------|--------|---------|
| Bold | `**text**` | **bold text** |
| Italic | `__text__` | __italic text__ |
| Highlight | `^^text^^` | ^^highlighted^^ |
| Strikethrough | `~~text~~` | ~~struck~~ |
| Inline code | `` `code` `` | `code` |
| LaTeX | `$$E=mc^2$$` | rendered math |

### Links & References
| Type | Syntax | Notes |
|------|--------|-------|
| Page reference | `[[Page Name]]` | Creates/links to page |
| Block reference | `((block-uid))` | Embeds block content inline |
| Block embed | `{{[[embed]]: ((block-uid))}}` | Full block embed with children |
| External link | `[text](URL)` | Standard markdown |
| Aliased page ref | `[display text]([[Actual Page]])` | Shows custom text, links to page |
| Aliased block ref | `[display text](<((block-uid))>)` | Links to specific block |
| Image embed | `![alt text](URL)` | Inline image |

### Tags & Hashtags
| Type | Syntax | When to Use |
|------|--------|-------------|
| Single word | `#tag` | Simple categorization |
| Multi-word | `#[[multiple words]]` | Phrases, compound concepts |
| Hyphenated | `#self-esteem` | Naturally hyphenated terms |

⚠️ **CRITICAL**: Never concatenate multi-word tags. `#knowledgemanagement` ≠ `#[[knowledge management]]`

### Dates
- **Always use ordinal format**: `[[January 1st, 2025]]`, `[[December 23rd, 2024]]`
- Ordinals: 1st, 2nd, 3rd, 4th–20th, 21st, 22nd, 23rd, 24th–30th, 31st

### Task Management
| Status | Syntax |
|--------|--------|
| Todo | `{{[[TODO]]}} task description` |
| Done | `{{[[DONE]]}} task description` |

### Attributes (Properties)
```
Type:: Book
Author:: [[Person Name]]
Rating:: 4/5
Source:: https://example.com
```

**Purpose**: Attributes create structured metadata that is **queryable across your entire graph**. The attribute name becomes a page reference, so only use `::` when the attribute is a reusable property that applies to multiple pages or concepts.

**When to USE attributes:**
| Attribute | Why It's Good |
|-----------|---------------|
| `Type:: Book` | Reusable across all media you consume |
| `Author:: [[Person]]` | Links to author page, queryable |
| `Status:: In Progress` | Standard project states, queryable |
| `Source:: URL` | Consistent sourcing across notes |
| `Date:: [[January 1st, 2025]]` | Enables date-based queries |

**When NOT to use attributes:**
| ❌ Wrong | ✅ Use Instead | Why |
|----------|----------------|-----|
| `Step 1:: Do this thing` | `**Step 1:** Do this thing` | Step numbers are page-specific, not queryable concepts |
| `Note:: Some observation` | Just write the text, or use `#note` | One-off labels don't need attribute syntax |
| `Summary:: The main point` | `**Summary:** The main point` | Section headers are formatting, not metadata |
| `Definition:: Some text` | `Term:: Definition` | Only use for actual definitions you want to query |
| `Implementation Tier 3 (Societal Restructuring):: Some text` | `** Implementation Tier 3 (Societal Restructuring)**: Some text` | Label is specific to current concept |

⚠️ **The Test**: Ask yourself: "Will I ever query for all blocks with this attribute across my graph?" If no, use **bold formatting** (`**Label:**`) instead of `::` syntax.

NOTE: Never combine bold markdown formatting with `::`. Roam formats attributes in bold by default. ✅ `<attribute>::` ❌ `**<attribute>**::`

---

## Block Structures

### Bullet Points
- Use `-` (dash) followed by space
- Nested bullets: indent with tab or spaces
```
- Parent item
    - Child item
        - Grandchild item
```

### Code Blocks
````
```javascript
const example = () => {
    return "syntax highlighted";
}
```
````

### Queries
```
{{[[query]]: {and: [[tag1]] [[tag2]]}}}
{{[[query]]: {or: [[optionA]] [[optionB]]}}}
{{[[query]]: {not: [[exclude-this]]}}}
{{[[query]]: {between: [[January 1st, 2025]] [[January 31st, 2025]]}}}
```

### Calculator
```
{{[[calc]]: 2 + 2}}
{{[[calc]]: 100 * 0.15}}
```

---

## Complex Structures

### Tables
Tables use nested indentation. Each column header/cell nests ONE LEVEL DEEPER than previous.

```
{{[[table]]}}
    - Header 1
        - Header 2
            - Header 3
    - Row 1 Label
        - Cell 1.1
            - Cell 1.2
                - Cell 1.3
    - Row 2 Label
        - Cell 2.1
            - Cell 2.2
                - Cell 2.3
```

**Rules:**
- `{{[[table]]}}` is level 1
- First header/row-label at level 2
- Each subsequent column nests +1 level deeper
- Keep tables ≤5 columns for readability

### Kanban Boards
```
{{[[kanban]]}}
    - Column 1 Title
        - Card 1 content
        - Card 2 content
    - Column 2 Title
        - Card 3 content
```

### Mermaid Diagrams
```
{{[[mermaid]]}}
    - graph TD
        - A[Start] --> B{Decision}
        - B -->|Yes| C[Action]
        - B -->|No| D[Alternative]
```

### Hiccup (Custom HTML)
`:hiccup [:iframe {:width "600" :height "400" :src "https://example.com"}]`

`:hiccup [:div {:style {:color "red"}} "Custom styled content"]`

---

## Anti-Patterns — DON'T DO THIS

| ❌ Wrong | ✅ Correct | Why |
|----------|-----------|-----|
| `Step 1:: Do this` | `**Step 1:** Do this` | `::` creates queryable attributes; use bold for page-specific labels |
| `#multiplewords` | `#[[multiple words]]` | Concatenated tags create dead references |
| `[[january 1, 2025]]` | `[[January 1st, 2025]]` | Must use ordinal format with proper capitalization |
| `[text](((block-uid)))` | `[text](<((block-uid))>)` | Block ref links need angle bracket wrapper |
| `{{embed: ((uid))}}` | `{{[[embed]]: ((uid))}}` | Embed requires double brackets around keyword |
| Deeply nested tables (6+ cols) | Max 4-5 columns | Becomes unreadable/unmanageable |
| `- *bullet` | `- bullet` | Use dash, not asterisk for bullets |
| `[[TODO]] task` | `{{[[TODO]]}} task` | TODO needs double curly braces |

---

## Tool Selection Decision Tree

```
CREATING CONTENT IN ROAM:

┌─ Is this a NEW standalone page with structure?
│   └─ YES → roam_create_page (with content array)
│
├─ Adding content to EXISTING page/block?
│   ├─ Simple outline structure → roam_create_outline
│   │   (provide page_title_uid and/or block_text_uid)
│   │
│   └─ Complex/nested markdown → roam_import_markdown
│       (for deeply nested content, tables, etc.)
│
├─ Need to CREATE, UPDATE, MOVE, or DELETE individual blocks?
│   └─ roam_process_batch_actions
│       (fine-grained control, temporary UIDs for parent refs)
│
├─ Adding a memory/note to remember?
│   └─ roam_remember (auto-tags with MEMORIES_TAG)
│
├─ Adding TODO items to today?
│   └─ roam_add_todo (creates individual TODO blocks)
│
└─ SEARCHING/READING:
    ├─ Find by tag → roam_search_for_tag
    ├─ Find by text → roam_search_by_text  
    ├─ Find by date range → roam_search_by_date
    ├─ Find by status → roam_search_by_status
    ├─ Get page content → roam_fetch_page_by_title
    ├─ Get block + children → roam_fetch_block_with_children
    ├─ Recall memories → roam_recall
    └─ Complex queries → roam_datomic_query
```

---

## API Efficiency Guidelines (Rate Limit Avoidance)

The Roam API has rate limits. Follow these guidelines to minimize API calls:

### Tool Efficiency Ranking (Best to Worst)
1. **`roam_process_batch_actions`** - Single API call for multiple operations (MOST EFFICIENT)
2. **`roam_create_page`** - Batches content with page creation
3. **`roam_create_outline` / `roam_import_markdown`** - Include verification queries (use for smaller operations)
4. **Multiple sequential tool calls** - Each call = multiple API requests (AVOID)

### Best Practices for Intensive Operations

#### When Updating/Revising a Page:
1. Fetch the page content ONCE at the start
2. Plan ALL changes needed (creates, updates, deletes)
3. Execute ALL changes in a SINGLE `roam_process_batch_actions` call
4. Do NOT fetch-modify-fetch-modify in a loop

#### When Creating Large Content:
- For 10+ blocks: Use `roam_process_batch_actions` with nested structure
- For simple outlines (<10 blocks): `roam_create_outline` is fine

#### UID Caching:
- Save UIDs from previous operations - don't re-query for them
- Use `page_uid` instead of `page_title` when available (avoids lookup query)
- Use `block_uid` instead of `block_text_uid` when you have it

#### UID Placeholders for Nested Blocks:
When using `roam_process_batch_actions` to create nested blocks, use **placeholder tokens** instead of generating UIDs yourself. The server generates proper random UIDs and returns a mapping.

**Syntax:** `{{uid:name}}` where `name` is any identifier you choose.

**Example:**
```json
[
  { "action": "create-block", "uid": "{{uid:parent}}", "string": "Parent Block", "location": { "parent-uid": "pageUid123", "order": 0 } },
  { "action": "create-block", "string": "Child Block", "location": { "parent-uid": "{{uid:parent}}", "order": 0 } }
]
```

**Response includes UID mapping:**
```json
{
  "success": true,
  "uid_map": {
    "parent": "Xk7mN2pQ9"
  }
}
```

**Why placeholders?** LLMs are not reliable random generators. The server uses cryptographically secure randomness to generate proper 9-character Roam UIDs.

### Example: Efficient Page Revision

**Instead of:**
```
1. roam_fetch_page_by_title → get content
2. roam_create_outline → add section 1
3. roam_create_outline → add section 2
4. roam_import_markdown → add more content
```

**Do this:**
```
1. roam_fetch_page_by_title → get page UID and content
2. roam_process_batch_actions → ALL creates/updates in one call
```

---

## Structural Defaults

When unsure how to structure output:

1. **Hierarchy depth**: Prefer 2-4 levels; rarely exceed 5
2. **Block length**: Keep blocks atomic — one idea per block
3. **Page refs vs hashtags**: 
   - `[[Page]]` for concepts you'll expand into full pages
   - `#tag` for categorization/filtering
4. **When to embed vs reference**:
   - `((uid))` — inline reference (shows content)
   - `{{[[embed]]: ((uid))}}` — full block with children
   - `[text](<((uid))>)` — clickable link only

---
## Visual Separation — Hierarchy First, Separators Never

Empty blocks and decorative dividers create clutter. Roam's outliner structure provides all the visual separation you need.

| ❌ Avoid | ✅ Instead |
|----------|-----------|
| Blank blocks | Let hierarchy create space — child blocks are visually indented |
| `---` dividers | Use a **heading block** to signal section breaks |
| Decorative lines `───` | Nest content under a parent block as a structural container |

**Principle**: If you feel the urge to add visual breathing room, you probably need *better structure*, not more blocks. Promote a block to a heading, or reorganize into parent/child relationships.

**The test**: If you'd delete it during cleanup, don't create it.

---

## Output Format Conventions

### Quotes
```
<quote text> —[[Author Name]] #quote #[[relevant topic]]
```

### Definitions
```
Term:: Definition text #definition #[[domain]]
```

### Questions for Future
```
{{[[TODO]]}} Research: <question> #[[open questions]]
```

---

*End of Generic Foundation — Personalization section follows during user setup.*
