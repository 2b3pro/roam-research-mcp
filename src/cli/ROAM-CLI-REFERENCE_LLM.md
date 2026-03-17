---
version: 2.17.0
date: 2026-01-12
last_modified: 2026-03-17
---

# Roam CLI Reference (LLM-Optimized)

## Critical: Multi-Graph Writes

```bash
# Protected graphs (like "system") require write-key
roam save -g system --write-key "$ROAM_SYSTEM_WRITE_KEY" "content"
roam update -g system --write-key "$ROAM_SYSTEM_WRITE_KEY" <uid> "content"
roam batch -g system --write-key "$ROAM_SYSTEM_WRITE_KEY" commands.json
```

## Command Syntax Templates

### `roam get` - Fetch

```bash
roam get <title|today|yesterday|tomorrow>       # page by title
roam get <9-char-uid>                           # block by UID
roam get page <uid|url|title>                   # explicit page (URL/UID/title)
roam get full <title>                           # full view: content + linked refs
roam get subpages <prefix>                      # list namespace sub-pages
roam get --uid <title>                          # resolve title→UID only
roam get --todo [-p <page>] [-i terms] [-e terms]
roam get --done [-p <page>]
roam get --tag <tag> [--negtag <tag>] [-p <page>] [--any] [-n limit]
roam get --text <text> [-p <page>]
```

Options: `-j` json, `-d N` depth (0=no children), `-a` ancestors (chain to page root), `-r [N]` expand refs, `-f` flat, `--sort created|modified|page`, `--group-by page|tag`

**Subcommands:**
- `roam get page <identifier>` - fetches page by UID, Roam URL, or title explicitly
- `roam get full <title>` - full page view: content + all linked references with breadcrumb context. Options: `-d N` depth (default 4), `-n N` max refs (default 200)
- `roam get subpages <prefix>` - list sub-pages under namespace prefix (e.g. "Project/"). Options: `--filter-tag <tag>`, `--content`

### `roam search` - Query

```bash
roam search <terms>                             # text search
roam search --tag <tag> [--any] [--negtag <tag>]
roam search --page <title> <terms>              # scoped search
roam search -q '<datalog>' [--inputs '<json>']  # raw Datalog
```

Options: `-i` case-insensitive, `-n` limit, `--json`

### `roam save` - Write

```bash
roam save "<text>"                              # to daily page
roam save "<text>" -p <page>                    # to specific page
roam save "<text>" --parent "<heading|((uid))>" # nested under block
roam save --todo "<text>"                       # TODO to daily
roam save file.md --title "<title>"             # new page from file
roam save file.md --title "<title>" --update    # smart update (preserves UIDs)
roam save -c "tag1,tag2" "<text>"               # with categories
roam save --json '[{...}]'                      # force JSON format
echo "text" | roam save [-p page]               # stdin
```

Options: `--flatten` disables heading hierarchy inference (all blocks at root)

Parent heading syntax: `"## Section"` (# prefix sets heading level, creates if missing)

### `roam update` - Modify Block

```bash
roam update <uid> "<content>"                   # replace text
roam update <uid> "# Title"                     # auto-detect H1
roam update <uid> -H <0-3>                      # set heading (0=remove)
roam update <uid> -T                            # set TODO
roam update <uid> -D                            # set DONE
roam update <uid> --clear-status                # remove TODO/DONE
roam update <uid> -o/-c                         # expand/collapse
```

UID accepts `((uid))` wrapper or raw uid

### `roam refs` - Find References

```bash
roam refs "<page title>"                        # blocks linking to page
roam refs "#tag"                                # blocks with tag
roam refs "((uid))"                             # blocks embedding block
```

Options: `-n` limit, `--json`, `--raw`

### `roam rename` - Rename Page

```bash
roam rename "<old>" "<new>"                     # by title
roam rename "<old>" "<new>" --uid <uid>         # by UID (old-title ignored)
```

Requires `--write-key` for protected graphs.

### `roam batch` - Bulk Operations

```bash
roam batch commands.json                        # from file
echo '<json>' | roam batch                      # from stdin
roam batch --dry-run commands.json              # preview (resolves pages)
roam batch --simulate commands.json             # validate offline
```

#### Batch Commands Schema

```json
[
  {"command": "todo", "params": {"text": "Task"}},
  {"command": "create", "params": {"parent": "<uid|daily|title|{{ref}>", "text": "Block", "as?": "alias", "heading?": 1-3, "order?": "first|last|N"}},
  {"command": "update", "params": {"uid": "<uid>", "text?": "New", "heading?": 0-3, "open?": bool}},
  {"command": "delete", "params": {"uid": "<uid>"}},
  {"command": "move", "params": {"uid": "<uid>", "parent": "<target>", "order?": "first|last|N"}},
  {"command": "page", "params": {"title": "Name", "as?": "alias", "content?": [{"text": "Block", "level": 1, "heading?": 1-3}]}},
  {"command": "outline", "params": {"parent": "<target>", "items": ["Item 1", "Item 2"]}},
  {"command": "table", "params": {"parent": "<target>", "headers": ["", "Col1"], "rows": [{"label": "Row1", "cells": ["val"]}]}},
  {"command": "remember", "params": {"text": "Memory", "categories?": ["tag1"]}},
  {"command": "codeblock", "params": {"parent": "<target>", "code": "...", "language?": "js"}}
]
```

**Parent values:** block UID, `"daily"`, page title (string), `{{alias}}` (from `as` param)

### `roam status` - Check Connection

```bash
roam status                                     # list graphs
roam status --ping                              # test connectivity
roam status --json                              # for scripting
```

## Common Patterns

| Task | Command |
|------|---------|
| Today's page content | `roam get today` |
| Page UID only | `roam get "Title" --uid` |
| All TODOs | `roam get --todo` |
| TODOs on page | `roam get --todo -p "Page"` |
| Blocks with tag | `roam get --tag "Tag"` |
| Multiple tags (AND) | `roam get --tag Tag1 --tag Tag2` |
| Multiple tags (OR) | `roam get --tag Tag1 --tag Tag2 --any` |
| Block + ancestors | `roam get <uid> -a` |
| Ancestors only | `roam get <uid> -a -d 0` |
| Full view + backlinks | `roam get full "Page"` |
| List sub-pages | `roam get subpages "Prefix"` |
| Quick note | `roam save "Note"` |
| Note to page | `roam save "Note" -p "Page"` |
| Under heading | `roam save --parent "## Section" "Note"` |
| TODO item | `roam save --todo "Task"` |
| New page | `roam save file.md --title "Page"` |
| Update page | `roam save file.md --title "Page" --update` |
| Find references | `roam refs "Page"` |
| Mark done | `roam update <uid> -D` |

## Output Formats

| Command | Default | JSON flag |
|---------|---------|-----------|
| `get` (page/block) | markdown | `-j` → full block structure with UIDs |
| `get --tag/--text` | markdown + count | `-j` → block array |
| `get --todo/--done` | markdown | `-j` → `[{block_uid, content, page_title}]` |
| `search` | flat list | `--json` → `[{block_uid, content, page_title}]` |
| `refs` | grouped by page | `--json` → `[{uid, content, page}]` |
| `batch` | always JSON | `{success, pages_created, actions_executed, uid_map?}` |

## Gotchas

1. **Write-key required** for non-default/protected graphs: `-g system --write-key "$ROAM_SYSTEM_WRITE_KEY"`
2. **Date pages** use ordinal format: `"January 3rd, 2026"` (not ISO)
3. **UIDs** are 9-char alphanumeric (`[a-zA-Z0-9_-]{9}`); accept `((uid))` wrapper
4. **--parent heading** syntax: `"## Section"` creates H2 heading if missing
5. **Batch parent** accepts: 9-char UID, `"daily"`, MM-DD-YYYY date, or `{{alias}}` placeholder — NOT page title strings directly
6. **Tag search** returns blocks WITH children; `--tag` uses AND by default, add `--any` for OR
7. **--update** on save does smart diff preserving block UIDs
8. **Limit defaults**: `get --tag/--text` = 20, `search` = 20, `refs` = 50
9. **Heading auto-detect**: `"# Title"` in content auto-sets H1 and strips `#` prefix
10. **Resolve page→UID first** for batch: `roam get "Page Title" --uid` then use UID in batch commands
11. **File import preferred** for complex content: `roam save file.md --title "Page"` handles nested markdown more reliably than programmatic block creation
12. **MCP/CLI sync lag**: Content created via CLI may not immediately appear in MCP fetches (use CLI to verify)
