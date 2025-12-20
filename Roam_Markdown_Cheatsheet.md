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
Attributes create structured metadata queryable across your graph.

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

#### Generating Temporary UIDs for Batch Operations:
When using `roam_process_batch_actions` to create nested blocks, you may need to generate temporary UIDs to reference parent blocks within the same batch.

**UID Format Requirements:**
- Exactly **9 characters** long
- Use only characters from: `a-z`, `A-Z`, `0-9`, `-`, `_`
- Must be **random/unique** — no human-readable patterns

| ✅ Valid UIDs | ❌ Invalid UIDs |
|---------------|-----------------|
| `Xk7mN2pQ9` | `my-block` (human-readable) |
| `aB3-dE_fG` | `section-1` (semantic) |
| `9Qw2Er5Ty` | `parent` (too short, readable) |

**Why this matters:** Roam stores whatever UID you provide. Human-readable UIDs like `layer-map` or `intro-block` work initially but cause issues later if reused or confused with actual content.

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
**Term**:: Definition text #definition #[[domain]]
```

### Questions for Future
```
{{[[TODO]]}} Research: <question> #[[open questions]]
```

---

*End of Generic Foundation — Personalization section follows during user setup.*
