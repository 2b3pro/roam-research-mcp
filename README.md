![](./roam-research-mcp-image.jpeg)

# Roam Research MCP Server

[![npm version](https://badge.fury.io/js/roam-research-mcp.svg)](https://badge.fury.io/js/roam-research-mcp)
[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/github/license/2b3pro/roam-research-mcp)](https://github.com/2b3pro/roam-research-mcp/blob/main/LICENSE)

A Model Context Protocol (MCP) server and standalone CLI that provides comprehensive access to Roam Research's API functionality. The MCP server enables AI assistants like Claude to interact with your Roam Research graph through a standardized interface, while the CLI (`roam`) lets you fetch, search, and import content directly from the command line. Supports standard input/output (stdio) and HTTP Stream communication. (A WORK-IN-PROGRESS, personal project not officially endorsed by Roam Research)

<a href="https://glama.ai/mcp/servers/fzfznyaflu"><img width="380" height="200" src="https://glama.ai/mcp/servers/fzfznyaflu/badge" alt="Roam Research MCP server" /></a>
<a href="https://mseep.ai/app/2b3pro-roam-research-mcp"><img width="380" height="200" src="https://mseep.net/pr/2b3pro-roam-research-mcp-badge.png" alt="MseeP.ai Security Assessment Badge" /></a>

## Installation and Usage

This MCP server supports two primary communication methods:

1.  **Stdio (Standard Input/Output):** Ideal for local inter-process communication, command-line tools, and direct integration with applications running on the same machine. This is the default communication method when running the server directly.
2.  **HTTP Stream:** Provides network-based communication, suitable for web-based clients, remote applications, or scenarios requiring real-time updates over HTTP. The HTTP Stream endpoint runs on port `8088` by default.

### Running with Stdio

You can install the package globally and run it:

```bash
npm install -g roam-research-mcp
roam-research-mcp
```

Or clone the repository and build from source:

```bash
git clone https://github.com/2b3pro/roam-research-mcp.git
cd roam-research-mcp
npm install
npm run build
npm start
```

### Running with HTTP Stream

To run the server with HTTP Stream support, you can either:

1.  **Use the default ports:** Run `npm start` after building (as shown above). The server will automatically listen on port `8088` for HTTP Stream.
2.  **Specify custom ports:** Set the `HTTP_STREAM_PORT` environment variable before starting the server.

    ```bash
    HTTP_STREAM_PORT=9000 npm start
    ```

    Or, if using a `.env` file, add `HTTP_STREAM_PORT=9000` to it.

## Docker

This project can be easily containerized using Docker. A `Dockerfile` is provided at the root of the repository.

### Build the Docker Image

To build the Docker image, navigate to the project root and run:

```bash
docker build -t roam-research-mcp .
```

### Run the Docker Container

To run the Docker container and map the necessary ports, you must also provide the required environment variables. Use the `-e` flag to pass `ROAM_API_TOKEN`, `ROAM_GRAPH_NAME`, and optionally `MEMORIES_TAG` and `HTTP_STREAM_PORT`:

```bash
docker run -p 3000:3000 -p 8088:8088 \
  -e ROAM_API_TOKEN="your-api-token" \
  -e ROAM_GRAPH_NAME="your-graph-name" \
  -e MEMORIES_TAG="#[[LLM/Memories]]" \
  -e CUSTOM_INSTRUCTIONS_PATH="/path/to/your/custom_instructions_file.md" \
  -e HTTP_STREAM_PORT="8088" \
  roam-research-mcp
```

Alternatively, if you have a `.env` file in the project root (which is copied into the Docker image during build), you can use the `--env-file` flag:

```bash
docker run -p 3000:3000 -p 8088:8088 --env-file .env roam-research-mcp
```

## Standalone CLI: `roam`

A standalone command-line tool for interacting with Roam Research directly, without running the MCP server. Provides four subcommands: `get`, `search`, `save`, and `refs`.

### Installation

After building the project, make the command globally available:

```bash
npm link
```

Or run directly without linking:

```bash
node build/cli/roam.js <command> [options]
```

### Requirements

Same environment variables as the MCP server:
- `ROAM_API_TOKEN`: Your Roam Research API token
- `ROAM_GRAPH_NAME`: Your Roam graph name

Configure via `.env` file in the project root or set as environment variables.

---

### `roam get` - Fetch pages, blocks, or TODOs

Fetch content from Roam and output as markdown or JSON.

```bash
# Fetch a page by title
roam get "Daily Notes"

# Fetch a block by UID
roam get "((AbCdEfGhI))"
roam get AbCdEfGhI

# Output as JSON
roam get "Daily Notes" --json

# Control child depth (default: 4)
roam get "Daily Notes" --depth 2

# Flatten hierarchy
roam get "Daily Notes" --flat

# Fetch TODO items
roam get --todo

# Fetch DONE items
roam get --done

# Filter TODOs by page
roam get --todo -p "January 2nd, 2026"

# Include/exclude filter
roam get --todo -i "urgent,important" -e "someday"

# Debug mode
roam get "Daily Notes" --debug
```

**Options:**
- `--json` - Output as JSON instead of markdown
- `--depth <n>` - Child levels to fetch (default: 4)
- `--refs <n>` - Block ref expansion depth (default: 1)
- `--flat` - Flatten hierarchy to single-level list
- `--todo` - Fetch TODO items
- `--done` - Fetch DONE items
- `-p, --page <title>` - Filter TODOs/DONEs by page title
- `-i, --include <terms>` - Include only items containing these terms (comma-separated)
- `-e, --exclude <terms>` - Exclude items containing these terms (comma-separated)
- `--debug` - Show query metadata

---

### `roam search` - Search content

Search for blocks containing text or tags.

```bash
# Full-text search
roam search "keyword"

# Multiple terms (AND logic)
roam search "term1" "term2"

# Tag-only search
roam search --tag "[[Project]]"
roam search --tag "#TODO"

# Text + tag filter
roam search "meeting" --tag "[[Work]]"

# Scope to a specific page
roam search "task" --page "Daily Notes"

# Case-insensitive search
roam search "keyword" -i

# Limit results (default: 20)
roam search "keyword" -n 50

# Output as JSON
roam search "keyword" --json
```

**Options:**
- `--tag <tag>` - Filter by tag (e.g., `#TODO` or `[[Project]]`)
- `--page <title>` - Scope search to a specific page
- `-i, --case-insensitive` - Case-insensitive search
- `-n, --limit <n>` - Limit number of results (default: 20)
- `--json` - Output as JSON
- `--debug` - Show query metadata

---

### `roam save` - Import markdown or create TODOs

Import markdown content to Roam, creating or updating pages, or add TODO items.

```bash
# From a file (title derived from filename)
roam save document.md

# With explicit title
roam save document.md --title "Meeting Notes"

# Update existing page with smart diff (preserves block UIDs)
roam save document.md --update

# From stdin (requires --title)
cat notes.md | roam save --title "Quick Notes"
pbpaste | roam save --title "Clipboard Content"

# From here-doc
roam save --title "Quick Note" << EOF
# Heading
- Item 1
- Item 2
  - Nested item
EOF

# Create a TODO item on today's daily page
roam save --todo "Buy groceries"

# Create multiple TODOs from stdin (newline-separated)
echo -e "Task 1\nTask 2\nTask 3" | roam save --todo

# Pipe TODO list from file
cat todos.txt | roam save --todo
```

**Options:**
- `--title <title>` - Page title (defaults to filename without `.md`)
- `--update` - Update existing page using smart diff (preserves block UIDs)
- `-t, --todo [text]` - Add a TODO item to today's daily page (text or stdin)
- `--debug` - Show debug information

**Features:**
- Creates a new page with the specified title (or appends to existing page)
- Automatically links the new page from today's daily page
- Converts standard markdown to Roam-flavored markdown
- Smart diff mode (`--update`) preserves block UIDs for existing content
- TODO mode creates `{{[[TODO]]}}` items on the daily page

---

### `roam refs` - Find references

Find blocks that reference a page or block (backlinks).

```bash
# Find references to a page
roam refs "Project Alpha"
roam refs "December 30th, 2025"

# Find references to a tag
roam refs "#TODO"
roam refs "[[Meeting Notes]]"

# Find references to a block
roam refs "((AbCdEfGhI))"

# Limit results
roam refs "My Page" -n 100

# Output as JSON (for LLM/programmatic use)
roam refs "My Page" --json

# Raw output (for piping)
roam refs "My Page" --raw
```

**Options:**
- `-n, --limit <n>` - Limit number of results (default: 50)
- `--json` - Output as JSON array
- `--raw` - Output raw UID + content lines (no grouping)
- `--debug` - Show query metadata

**Output Formats:**

Default output groups results by page:
```
[[Reading List: Inbox]]
  tiTqNBvYA   Date Captured:: [[December 30th, 2025]]

[[Week 53, 2025]]
  g0ur1z7Bs   [Sun 28]([[December 28th, 2025]]) | [Mon 29](...
```

JSON output for programmatic use:
```json
[
  {"uid": "tiTqNBvYA", "content": "Date Captured:: [[December 30th, 2025]]", "page": "Reading List: Inbox"}
]
```

---

## To Test

Run [MCP Inspector](https://github.com/modelcontextprotocol/inspector) after build using the provided npm script:

```bash
npm run inspector
```

## Features

The server provides powerful tools for interacting with Roam Research:

- Environment variable handling with .env support
- Comprehensive input validation
- Case-insensitive page title matching
- Recursive block reference resolution
- Markdown parsing and conversion
- Daily page integration
- Detailed debug logging
- Efficient batch operations
- Hierarchical outline creation
- Enhanced documentation for Roam Tables in `Roam_Markdown_Cheatsheet.md` for clearer guidance on nesting.
  - Custom instruction appended to the cheat sheet about your specific Roam notes.

1. `roam_fetch_page_by_title`: Fetch page content by title. Returns content in the specified format.
2. `roam_fetch_block_with_children`: Fetch a block by its UID along with its hierarchical children down to a specified depth. Automatically handles `((UID))` formatting.
3. `roam_create_page`: Create new pages with optional content and headings. **Now supports mixed content types** - content array can include both text blocks and tables in a single call using `{type: "table", headers, rows}` format. Creates a block on the daily page linking to the newly created page.
4. `roam_create_table`: Create a properly formatted Roam table with specified headers and rows. Abstracts Roam's complex nested table structure, validates row/column consistency, and handles empty cells automatically.
5. `roam_import_markdown`: Import nested markdown content under a specific block. (Internally uses `roam_process_batch_actions`.)
6. `roam_add_todo`: Add a list of todo items to today's daily page. (Internally uses `roam_process_batch_actions`.)
7. `roam_create_outline`: Add a structured outline to an existing page or block, with support for `children_view_type`. Best for simpler, sequential outlines. For complex nesting (e.g., tables), consider `roam_process_batch_actions`. If `page_title_uid` and `block_text_uid` are both blank, content defaults to the daily page. (Internally uses `roam_process_batch_actions`.)
8. `roam_search_block_refs`: Search for block references within a page or across the entire graph. Now supports `title` parameter to find blocks referencing a page title using `:block/refs` (captures `[[page]]` and `#tag` links semantically).
9. `roam_search_hierarchy`: Search for parent or child blocks in the block hierarchy.
10. `roam_find_pages_modified_today`: Find pages that have been modified today (since midnight), with pagination and sorting options.
11. `roam_search_by_text`: Search for blocks containing specific text across all pages or within a specific page. This tool supports pagination via the `limit` and `offset` parameters.
12. `roam_search_by_status`: Search for blocks with a specific status (TODO/DONE) across all pages or within a specific page.
13. `roam_search_by_date`: Search for blocks or pages based on creation or modification dates.
14. `roam_search_for_tag`: Search for blocks containing a specific tag and optionally filter by blocks that also contain another tag nearby or exclude blocks with a specific tag. This tool supports pagination via the `limit` and `offset` parameters.
15. `roam_remember`: Add a memory or piece of information to remember. Supports optional `heading` parameter to nest under a specific heading on the daily page (created if missing), or `parent_uid` to nest under a specific block. (Internally uses `roam_process_batch_actions`.)
16. `roam_recall`: Retrieve all stored memories.
17. `roam_datomic_query`: Execute a custom Datomic query on the Roam graph for advanced data retrieval beyond the available search tools. Now supports client-side regex filtering for enhanced post-query processing. Optimal for complex filtering (including regex), highly complex boolean logic, arbitrary sorting criteria, and proximity search.
18. `roam_markdown_cheatsheet`: Provides the content of the Roam Markdown Cheatsheet resource, optionally concatenated with custom instructions if `CUSTOM_INSTRUCTIONS_PATH` environment variable is set.
19. `roam_process_batch_actions`: Execute a sequence of low-level block actions (create, update, move, delete) in a single, non-transactional batch. Provides granular control for complex nesting like tables. **Now includes pre-validation** that catches errors before API execution, with structured error responses and automatic rate limit retry with exponential backoff. (Note: For actions on existing blocks or within a specific page context, it is often necessary to first obtain valid page or block UIDs using tools like `roam_fetch_page_by_title`.)
20. `roam_update_page_markdown`: Update an existing page with new markdown content using smart diff. **Preserves block UIDs** where possible, keeping references intact across the graph. Uses three-phase matching (exact text → normalized → position fallback) to generate minimal operations. Supports `dry_run` mode to preview changes. Ideal for syncing external markdown files, AI-assisted content updates, and batch modifications without losing block references.
21. `roam_move_block`: Move a block to a new location (different parent or position). Convenience wrapper around `roam_process_batch_actions` for single block moves. Parameters: `block_uid` (required), `parent_uid` (required), `order` (optional, defaults to "last").

**Deprecated Tools**:
The following tools have been deprecated as of `v0.36.2` in favor of the more powerful and flexible `roam_process_batch_actions`:

- `roam_create_block`: Use `roam_process_batch_actions` with the `create-block` action.
- `roam_update_block`: Use `roam_process_batch_actions` with the `update-block` action.
- `roam_update_multiple_blocks`: Use `roam_process_batch_actions` with multiple `update-block` actions.

---

### Tool Usage Guidelines and Best Practices

**Pre-computation and Context Loading:**
✅ Before attempting any Roam operations, **it is highly recommended** to load the `Roam Markdown Cheatsheet` resource into your context. This ensures you have immediate access to the correct Roam-flavored Markdown syntax, including details for tables, block references, and other special formatting. Example prompt: "Read the Roam cheatsheet first. Then, … <rest of your instructions>"

- **Specific notes and preferences** concerning my Roam Research graph. Users can add their own specific notes and preferences for working with their own graph in the Cheatsheet.

**Identifying Pages and Blocks for Manipulation:**
To ensure accurate operations, always strive to identify target pages and blocks using their Unique Identifiers (UIDs) whenever possible. While some tools accept case-sensitive text titles or content, UIDs provide unambiguous references, reducing the risk of errors due to ambiguity or changes in text.

- **For Pages:** Use `roam_fetch_page_by_title` to retrieve a page's UID if you only have its title. Example: "Read the page titled 'Trip to Las Vegas'"
- **For Blocks:** If you need to manipulate an existing block, first use search tools like `roam_search_by_text`, `roam_search_for_tag`, or `roam_fetch_page_by_title` (with raw format) to find the block and obtain its UID. If the block exists on a page that has already been read, then a search isn't necessary.

**Case-Sensitivity:**
Be aware that text-based inputs (e.g., page titles, block content for search) are generally case-sensitive in Roam. Always match the exact casing of the text as it appears in your graph.

**Iterative Refinement and Verification:**
For complex operations, especially those involving nested structures or multiple changes, it is often beneficial to break down the task into smaller, verifiable steps. After each significant tool call, consider fetching the affected content to verify the changes before proceeding.

**Understanding Tool Nuances:**
Familiarize yourself with the specific behaviors and limitations of each tool. For instance, `roam_create_outline` is best for sequential outlines, while `roam_process_batch_actions` offers granular control for complex structures like tables. Refer to the individual tool descriptions for detailed usage notes.

When making changes to your Roam graph, precision in your requests is crucial for achieving desired outcomes.

**Specificity in Requests:**
Some tools allow for identifying blocks or pages by their text content (e.g., `parent_string`, `title`). While convenient, using **Unique Identifiers (UIDs)** is always preferred for accuracy and reliability. Text-based matching can be prone to errors if there are multiple blocks with similar content or if the content changes. Tools are designed to work best when provided with explicit UIDs where available.

**Example of Specificity:**
Instead of:
`"parent_string": "My project notes"`

Prefer:
`"parent_uid": "((some-unique-uid))"`

**Caveat Regarding Heading Formatting:**
Please note that while the `roam_process_batch_actions` tool can set block headings (H1, H2, H3), directly **removing** an existing heading (i.e., reverting a heading block to a plain text block) through this tool is not currently supported by the Roam API. The `heading` attribute persists its value once set, and attempting to remove it by setting `heading` to `0`, `null`, or omitting the property will not unset the heading.

---

## Example Prompts

Here are some examples of how to creatively use the Roam tool in an LLM to interact with your Roam graph, particularly leveraging `roam_process_batch_actions` for complex operations.

### Example 1: Creating a Project Outline

This prompt demonstrates creating a new page and populating it with a structured outline using a single `roam_process_batch_actions` call.

```
"Create a new Roam page titled 'Project Alpha Planning' and add the following outline:
- Overview
  - Goals
  - Scope
- Team Members
  - John Doe
  - Jane Smith
- Tasks
  - Task 1
    - Subtask 1.1
    - Subtask 1.2
  - Task 2
- Deadlines"
```

### Example 2: Updating Multiple To-Dos and Adding a New One

This example shows how to mark existing to-do items as `DONE` and add a new one, all within a single batch.

```
"Mark 'Finish report' and 'Review presentation' as done on today's daily page, and add a new todo 'Prepare for meeting'."
```

### Example 3: Moving and Updating a Block

This demonstrates moving a block from one location to another and simultaneously updating its content.

```
"Move the block 'Important note about client feedback' (from page 'Meeting Notes 2025-06-30') under the 'Action Items' section on the 'Project Alpha Planning' page, and change its content to 'Client feedback reviewed and incorporated'."
```

### Example 4: Making a Table

This demonstrates creating a standalone table on a page.

```
"In Roam, add a new table on the page "Fruity Tables" that compares four types of fruits: apples, oranges, grapes, and dates. Choose randomly four areas to compare."
```

### Example 5: Creating a Page with Mixed Content (Text + Table)

This demonstrates creating a new page with both text blocks and a table in a single call using `roam_create_page`.

```
"Create a new Roam page titled 'Product Comparison' with:
- A heading 'Overview'
- An introduction paragraph explaining the comparison
- A comparison table with columns: Feature, Plan A, Plan B
  - Rows: Price ($10, $20), Storage (10GB, 50GB), Support (Email, 24/7)
- A conclusion section"
```

### Example 6: Updating a Page with Smart Diff

This demonstrates updating an existing page while preserving block UIDs (and therefore block references across the graph).

```
"Update the 'Project Alpha Planning' page with this revised content, preserving block references:
- Overview (keep existing UID)
  - Updated Goals section
  - Revised Scope with new details
- Team Members
  - John Doe (Senior Dev)
  - Jane Smith (PM)
  - New hire: Bob Wilson
- Updated Timeline
- Remove the old 'Deadlines' section"
```

The tool will match existing blocks by content, update changed text, add new blocks, and remove deleted ones - all while keeping UIDs stable for blocks that still exist.

---

## Setup

1. Create a [Roam Research API token](https://x.com/RoamResearch/status/1789358175474327881):

   - Go to your graph settings
   - Navigate to the "API tokens" section (Settings > "Graph" tab > "API Tokens" section and click on the "+ New API Token" button)
   - Create a new token

2. Configure the environment variables:

   ### Single Graph Mode (Default)

   For most users with one Roam graph, use the simple configuration:

   **Option 1: Using a .env file (Recommended for development)**

   Create a `.env` file in the roam-research directory:

   ```
   ROAM_API_TOKEN=your-api-token
   ROAM_GRAPH_NAME=your-graph-name
   MEMORIES_TAG='#[[LLM/Memories]]'
   CUSTOM_INSTRUCTIONS_PATH='/path/to/your/custom_instructions_file.md'
   HTTP_STREAM_PORT=8088 # Or your desired port for HTTP Stream communication
   ```

   **Option 2: Using MCP settings (Alternative method)**

   Add the configuration to your MCP settings file. Note that you may need to update the `args` to `["/path/to/roam-research-mcp/build/index.js"]` if you are running the server directly.

   - For Cline (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):
   - For Claude desktop app (`~/Library/Application Support/Claude/claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "roam-research": {
         "command": "node",
         "args": ["/path/to/roam-research-mcp/build/index.js"],
         "env": {
           "ROAM_API_TOKEN": "your-api-token",
           "ROAM_GRAPH_NAME": "your-graph-name",
           "MEMORIES_TAG": "#[[LLM/Memories]]",
           "CUSTOM_INSTRUCTIONS_PATH": "/path/to/your/custom_instructions_file.md",
           "HTTP_STREAM_PORT": "8088"
         }
       }
     }
   }
   ```

   Note: The server will first try to load from .env file, then fall back to environment variables from MCP settings.

   ---

   ### Multi-Graph Mode (v2.0.0+)

   For users with multiple Roam graphs, you can configure a single MCP server instance to connect to all of them. This is more token-efficient than running multiple server instances.

   **Configuration:**

   ```json
   ROAM_GRAPHS="{\"personal\":{\"token\":\"roam-graph-token-xxx\",\"graph\":\"my-personal-graph\"},\"work\":{\"token\":\"roam-graph-token-yyy\",\"graph\":\"company-graph\",\"write_key\":\"confirm-work-write\"}}"
   ROAM_DEFAULT_GRAPH=personal
   ```

   | Field | Required | Description |
   |-------|----------|-------------|
   | `token` | Yes | Roam API token for this graph |
   | `graph` | Yes | Roam graph name |
   | `write_key` | No | Required confirmation string for writes to non-default graphs |

   **Usage in Tools:**

   All tools accept optional `graph` and `write_key` parameters:

   ```json
   {
     "title": "My Page",
     "graph": "work",
     "write_key": "confirm-work-write"
   }
   ```

   - **Read operations**: Can target any graph using the `graph` parameter
   - **Write operations on default graph**: Work without additional parameters
   - **Write operations on non-default graphs**: Require the `write_key` if configured

   **CLI Usage:**

   All CLI commands support the `-g, --graph` flag:

   ```bash
   # Read from work graph
   roam get "Meeting Notes" -g work

   # Write to work graph (requires --write-key if configured)
   roam save notes.md -g work --write-key "confirm-work-write"
   ```

   **Safety Model:**

   The `write_key` serves as a confirmation gate (not a secret) to prevent accidental writes to non-default graphs. When a write is attempted without the required key, the error message reveals the expected key:

   ```
   Write to "work" graph requires write_key confirmation.
   Provide write_key: "confirm-work-write" to proceed.
   ```

3. Build the server (make sure you're in the root directory of the MCP):

   Note: Customize 'Roam_Markdown_Cheatsheet.md' with any notes and preferences specific to your graph BEFORE building.

   ```bash
   cd roam-research-mcp
   npm install
   npm run build
   ```

## Error Handling

The server provides comprehensive error handling for common scenarios:

- Configuration errors:
  - Missing API token or graph name
  - Invalid environment variables
- API errors:
  - Authentication failures
  - Invalid requests
  - Failed operations
- Tool-specific errors:
  - Page not found (with case-insensitive search)
  - Block not found by string match
  - Invalid markdown format
  - Missing required parameters
  - Invalid outline structure or content

Each error response includes:

- Standard MCP error code
- Detailed error message
- Suggestions for resolution when applicable

---

## Development

### Building

To build the server:

```bash
npm install
npm run build
```

This will:

1. Install all required dependencies
2. Compile TypeScript to JavaScript
3. Make the output file executable

You can also use `npm run watch` during development to automatically recompile when files change.

### Testing with MCP Inspector

The MCP Inspector is a tool that helps test and debug MCP servers. To test the server:

```bash
# Inspect with npx:
npx @modelcontextprotocol/inspector node build/index.js
```

This will:

1. Start the server in inspector mode
2. Provide an interactive interface to:
   - List available tools and resources
   - Execute tools with custom parameters
   - View tool responses and error handling

## License

MIT License

---

## About the Author

This project is maintained by [Ian Shen](https://github.com/2b3pro).
