# Roam Research CLI v2.2.0

As of 2026-01-03

Command-line interface for interacting with Roam Research graphs.

## Installation

```bash
npm link  # Makes `roam` command globally available
```

## Commands

```
roam [options] [command]

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  get             Fetch pages, blocks, or TODO/DONE items
  search          Search blocks by text, tags, or Datalog queries
  save            Save text, files, or JSON to pages/blocks
  refs            Find all blocks that reference a page, tag, or block
  update          Update block content, heading, or status
  batch           Execute multiple block operations efficiently
```

---

## `roam get`

Fetch pages, blocks, or TODO/DONE items with optional ref expansion.

```
Usage: roam get [options] [target]

Arguments:
  target                 Page title, block UID, or relative date
                         (today/yesterday/tomorrow)

Options:
  -j, --json             Output as JSON instead of markdown
  -d, --depth <n>        Child levels to fetch (default: 4)
  -r, --refs [n]         Expand ((uid)) refs in output (default depth: 1, max: 4)
  -f, --flat             Flatten hierarchy to single-level list
  --todo                 Fetch TODO items
  --done                 Fetch DONE items
  -p, --page <ref>       Filter TODOs/DONEs by page title or UID
  -i, --include <terms>  Include items matching these terms (comma-separated)
  -e, --exclude <terms>  Exclude items matching these terms (comma-separated)
  -g, --graph <name>     Target graph key (multi-graph mode)
  --debug                Show query metadata
```

### Examples

```bash
# Fetch pages
roam get "Project Notes"                    # Page by title
roam get today                              # Today's daily page
roam get yesterday                          # Yesterday's daily page
roam get tomorrow                           # Tomorrow's daily page

# Fetch blocks
roam get abc123def                          # Block by UID
roam get "((abc123def))"                    # UID with wrapper

# Output options
roam get "Page" -j                          # JSON output
roam get "Page" -f                          # Flat list (no hierarchy)
roam get abc123def -d 2                     # Limit depth to 2 levels
roam get "Page" -r                          # Expand block refs (depth 1)
roam get "Page" -r 3                        # Expand refs up to 3 levels deep

# TODO/DONE items (refs auto-expanded)
roam get --todo                             # All TODOs across graph
roam get --done                             # All completed items
roam get --todo -p "Work"                   # TODOs on "Work" page
roam get --todo -i "urgent,blocker"         # TODOs containing these terms
roam get --todo -e "someday,maybe"          # Exclude items with terms
```

---

## `roam search`

Search blocks by text, tags, Datalog queries, or within specific pages.

```
Usage: roam search [options] [terms...]

Arguments:
  terms                   Search terms (multiple terms use AND logic)

Options:
  --tag <tag>             Filter by tag (repeatable, comma-separated). Default: AND logic
  --any                   Use OR logic for multiple tags (default is AND)
  --negtag <tag>          Exclude blocks with tag (repeatable, comma-separated)
  --page <title>          Scope search to a specific page
  -i, --case-insensitive  Case-insensitive search
  -n, --limit <n>         Limit number of results (default: 20)
  --json                  Output as JSON
  --debug                 Show query metadata
  -g, --graph <name>      Target graph key (for multi-graph mode)
  -q, --query <datalog>   Raw Datalog query (bypasses other search options)
  --inputs <json>         JSON array of inputs for Datalog query
  --regex <pattern>       Client-side regex filter on Datalog results
  --regex-flags <flags>   Regex flags (e.g., "i" for case-insensitive)
```

### Examples

```bash
# Text search
roam search "meeting notes"               # Find blocks containing text
roam search api integration               # Multiple terms (AND logic)
roam search "bug fix" -i                  # Case-insensitive search

# Tag search
roam search --tag TODO                    # All blocks with #TODO
roam search --tag "[[Project Alpha]]"     # Blocks with page reference
roam search --tag work --page "January 3rd, 2026"  # Tag on specific page

# Multiple tags
roam search --tag TODO --tag urgent       # Blocks with BOTH tags (AND)
roam search --tag "TODO,urgent,blocked"   # Comma-separated (AND)
roam search --tag TODO --tag urgent --any # Blocks with ANY tag (OR)

# Exclude tags
roam search --tag TODO --negtag done      # TODOs excluding #done
roam search --tag TODO --negtag "someday,maybe"  # Exclude multiple tags

# Combined filters
roam search urgent --tag TODO             # Text + tag filter
roam search "review" --page "Work"        # Search within page

# Output options
roam search "design" -n 50                # Limit to 50 results
roam search "api" --json                  # JSON output

# Datalog queries (advanced)
roam search -q '[:find ?title :where [?e :node/title ?title]]'
roam search -q '[:find ?s :in $ ?term :where [?b :block/string ?s] [(clojure.string/includes? ?s ?term)]]' --inputs '["TODO"]'
roam search -q '[:find ?uid ?s :where [?b :block/uid ?uid] [?b :block/string ?s]]' --regex "meeting" --regex-flags "i"
```

### Datalog Tips

Common attributes: `:node/title`, `:block/string`, `:block/uid`, `:block/page`, `:block/children`

Predicates: `clojure.string/includes?`, `clojure.string/starts-with?`, `<`, `>`, `=`

---

## `roam save`

Save text, files, or JSON to pages/blocks. Auto-detects format.

```
Usage: roam save [options] [input]

Arguments:
  input                    Text, file path, or "-" for stdin (auto-detected)

Options:
  --title <title>          Create a new page with this title
  --update                 Update existing page using smart diff (preserves block UIDs)
  -p, --page <ref>         Target page by title or UID (default: daily page, creates if missing)
  --parent <ref>           Nest under block UID ((uid)) or heading text (creates if missing)
                           Use # prefix for heading level: "## Section"
  -c, --categories <tags>  Comma-separated tags appended to first block
  -t, --todo [text]        Add TODO item(s) to daily page. Accepts inline text or stdin
  --json                   Force JSON array format: [{text, level, heading?}, ...]
  -g, --graph <name>       Target graph key (multi-graph mode)
  --write-key <key>        Write confirmation key (non-default graphs)
  --debug                  Show debug information
```

### Examples

```bash
# Quick saves to daily page
roam save "Quick note"                          # Single block
roam save "# Important" -c "work,urgent"        # H1 heading with tags
roam save --todo "Buy groceries"                # TODO item

# Save under heading (creates if missing)
roam save --parent "## Notes" "My note"         # Under H2 "Notes" heading
roam save --parent "((blockUid9))" "Child"      # Under specific block

# Target specific page
roam save -p "Project X" "Status update"        # By title (creates if missing)
roam save -p "pageUid123" "Note"                # By UID

# File operations
roam save notes.md --title "My Notes"           # Create page from file
roam save notes.md --title "My Notes" --update  # Smart update (preserves UIDs)
cat data.json | roam save --json                # Pipe JSON blocks

# Combine options
roam save -p "Work" --parent "## Today" "Done with task" -c "wins"
```

### JSON Format

Array of blocks with text, level, and optional heading:

```json
[
  {"text": "# Main Title", "level": 1},
  {"text": "Subheading", "level": 1, "heading": 2},
  {"text": "Nested content", "level": 2},
  {"text": "Sibling", "level": 2}
]
```

---

## `roam refs`

Find all blocks that reference a page, tag, or block.

```
Usage: roam refs [options] <identifier>

Arguments:
  identifier          Page title, #tag, [[Page]], or ((block-uid))

Options:
  -n, --limit <n>     Limit number of results (default: 50)
  --json              Output as JSON array
  --raw               Output raw UID + content lines (no grouping)
  --debug             Show query metadata
  -g, --graph <name>  Target graph key (for multi-graph mode)
```

### Examples

```bash
# Page references
roam refs "Project Alpha"               # Blocks linking to page
roam refs "[[Meeting Notes]]"           # With bracket syntax
roam refs "#TODO"                       # Blocks with #TODO tag

# Block references
roam refs "((abc123def))"               # Blocks embedding this block

# Output options
roam refs "Work" --json                 # JSON array output
roam refs "Ideas" --raw                 # Raw UID + content (no grouping)
roam refs "Tasks" -n 100                # Limit to 100 results
```

---

## `roam update`

Update block content, heading, open/closed state, or TODO/DONE status.

```
Usage: roam update [options] <uid> <content>

Arguments:
  uid                    Block UID to update (accepts ((uid)) wrapper)
  content                New content. Use # prefix for heading: "# Title" sets H1

Options:
  -H, --heading <level>  Set heading level (1-3), or 0 to remove
  -o, --open             Expand block (show children)
  -c, --closed           Collapse block (hide children)
  -T, --todo             Set as TODO (replaces DONE if present, prepends if none)
  -D, --done             Set as DONE (replaces TODO if present, prepends if none)
  --clear-status         Remove TODO/DONE marker
  -g, --graph <name>     Target graph key (multi-graph mode)
  --write-key <key>      Write confirmation key (non-default graphs)
  --debug                Show debug information
```

### Examples

```bash
# Basic update
roam update abc123def "New content"         # Update block text
roam update "((abc123def))" "New content"   # UID with wrapper

# Heading updates
roam update abc123def "# Main Title"        # Auto-detect H1, strip #
roam update abc123def "Title" -H 2          # Explicit H2
roam update abc123def "Plain text" -H 0     # Remove heading

# Block state
roam update abc123def "Content" -o          # Expand block
roam update abc123def "Content" -c          # Collapse block

# TODO/DONE status
roam update abc123def "Task" -T             # Set as TODO
roam update abc123def "Task" -D             # Mark as DONE
roam update abc123def "Task" --clear-status # Remove status marker
```

---

## `roam batch`

Execute multiple block operations efficiently in a single API call.

```
Usage: roam batch [options] [file]

Arguments:
  file                JSON file with commands (or pipe via stdin)

Options:
  --debug             Show debug information
  --dry-run           Validate and show planned actions without executing
  --simulate          Validate structure offline (no API calls)
  -g, --graph <name>  Target graph key (for multi-graph mode)
  --write-key <key>   Write confirmation key (for non-default graphs)
```

### Examples

```bash
# From file
roam batch commands.json                # Execute commands from file
roam batch commands.json --dry-run      # Preview without executing (resolves pages)
roam batch commands.json --simulate     # Validate offline (no API calls)

# From stdin
cat commands.json | roam batch          # Pipe commands
echo '[{"command":"todo","params":{"text":"Task 1"}}]' | roam batch
```

### Command Schemas

| Command | Parameters |
|---------|------------|
| `todo` | `{text}` |
| `create` | `{parent, text, as?, heading?, order?}` |
| `update` | `{uid, text?, heading?, open?}` |
| `delete` | `{uid}` |
| `move` | `{uid, parent, order?}` |
| `page` | `{title, as?, content?: [{text, level, heading?}...]}` |
| `outline` | `{parent, items: [string...]}` |
| `table` | `{parent, headers: [string...], rows: [{label, cells: [string...]}...]}` |
| `remember` | `{text, categories?: [string...]}` |
| `codeblock` | `{parent, code, language?}` |

**Parent accepts:** block UID, `"daily"`, page title, or `{{placeholder}}`

### Batch Example

```json
[
  {"command": "page", "params": {"title": "Project X", "as": "proj"}},
  {"command": "create", "params": {"parent": "{{proj}}", "text": "# Overview", "as": "overview"}},
  {"command": "outline", "params": {"parent": "{{overview}}", "items": ["Goal 1", "Goal 2"]}},
  {"command": "todo", "params": {"text": "Review project"}}
]
```

---

## Multi-Graph Mode

All commands support `-g, --graph <name>` to target a specific graph when multiple graphs are configured.

For write operations on non-default graphs, use `--write-key <key>` to confirm write access.

```bash
# Example: Save to work graph
roam save -g work --write-key confirm "Meeting notes"
```

See the main project documentation for environment variable configuration.
