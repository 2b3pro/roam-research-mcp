# Roam Research MCP Server

[![npm version](https://badge.fury.io/js/roam-research-mcp.svg)](https://badge.fury.io/js/roam-research-mcp)
[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/github/license/2b3pro/roam-research-mcp)](https://github.com/2b3pro/roam-research-mcp/blob/main/LICENSE)
[![smithery badge](https://smithery.ai/badge/roam-research-mcp)](https://smithery.ai/server/roam-research-mcp)

A Model Context Protocol (MCP) server that provides comprehensive access to Roam Research's API functionality. This server enables AI assistants like Claude to interact with your Roam Research graph through a standardized interface. (A WORK-IN-PROGRESS, personal project not officially endorsed by Roam Research)

<a href="https://glama.ai/mcp/servers/fzfznyaflu"><img width="380" height="200" src="https://glama.ai/mcp/servers/fzfznyaflu/badge" alt="Roam Research MCP server" /></a>

## Installation

### Installing via Smithery

To install Roam Research MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/roam-research-mcp):

```bash
npx -y @smithery/cli install roam-research-mcp --client claude
```

### Installing Manually

You can install the package globally:

```bash
npm install -g roam-research-mcp
```

Or clone the repository and build from source:

```bash
git clone https://github.com/2b3pro/roam-research-mcp.git
cd roam-research-mcp
npm install
npm run build
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

1. `roam_fetch_page_by_title`: Fetch and read a page's content by title, recursively resolving block references up to 4 levels deep
2. `roam_create_page`: Create new pages with optional content
3. `roam_create_block`: Create new blocks in a page (defaults to today's daily page)
4. `roam_import_markdown`: Import nested markdown content under specific blocks
5. `roam_add_todo`: Add multiple todo items to today's daily page with checkbox syntax
6. `roam_create_outline`: Create hierarchical outlines with proper nesting and structure
7. `roam_search_block_refs`: Search for block references within pages or across the graph
8. `roam_search_hierarchy`: Navigate and search through block parent-child relationships
9. `find_pages_modified_today`: Find all pages that have been modified since midnight today
10. `roam_search_by_text`: Search for blocks containing specific text across all pages or within a specific page
11. `roam_update_block`: Update block content with direct text or pattern-based transformations
12. `roam_search_by_date`: Search for blocks and pages based on creation or modification dates
13. `roam_search_for_tag`: Search for blocks containing specific tags with optional filtering by nearby tags
14. `roam_remember`: Store and categorize memories or information with automatic tagging
15. `roam_recall`: Recall memories of blocks marked with tag MEMORIES_TAG (see below) or blocks on page title of the same name
16. `roam_datomic_query`: Execute custom Datalog queries on the Roam graph for advanced data retrieval and analysis

## Setup

1. Create a [Roam Research API token](https://x.com/RoamResearch/status/1789358175474327881):

   - Go to your graph settings
   - Navigate to the "API tokens" section (Settings > "Graph" tab > "API Tokens" section and click on the "+ New API Token" button)
   - Create a new token

2. Configure the environment variables:
   You have two options for configuring the required environment variables:

   Option 1: Using a .env file (Recommended for development)
   Create a `.env` file in the roam-research directory:

   ```
   ROAM_API_TOKEN=your-api-token
   ROAM_GRAPH_NAME=your-graph-name
   MEMORIES_TAG='#[[LLM/Memories]]'
   ```

   Option 2: Using MCP settings (Alternative method)
   Add the configuration to your MCP settings file:

   - For Cline (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):
   - For Claude desktop app (`~/Library/Application Support/Claude/claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "roam-research": {
         "command": "node",
         "args": ["/path/to/roam-research/build/index.js"],
         "env": {
           "ROAM_API_TOKEN": "your-api-token",
           "ROAM_GRAPH_NAME": "your-graph-name",
           "MEMORIES_TAG": "#[[LLM/Memories]]"
         }
       }
     }
   }
   ```

   Note: The server will first try to load from .env file, then fall back to environment variables from MCP settings.

3. Build the server:
   ```bash
   cd roam-research
   npm install
   npm run build
   ```

## Usage

### Fetch Page By Title

Fetch and read a page's content with resolved block references:

```typescript
use_mcp_tool roam-research roam_fetch_page_by_title {
  "title": "Example Page"
}
```

Returns the page content as markdown with:

- Complete hierarchical structure
- Block references recursively resolved (up to 4 levels deep)
- Proper indentation for nesting levels
- Full markdown formatting

### Create Page

Create a new page with optional content:

```typescript
use_mcp_tool roam-research roam_create_page {
  "title": "New Page",
  "content": "Initial content for the page"
}
```

Returns the created page's UID on success.

### Create Block

Add a new block to a page (defaults to today's daily page if neither page_uid nor title provided):

```typescript
use_mcp_tool roam-research roam_create_block {
  "content": "Block content",
  "page_uid": "optional-target-page-uid",
  "title": "optional-target-page-title"
}
```

You can specify either:

- `page_uid`: Direct reference to target page
- `title`: Name of target page (will be created if it doesn't exist)
- Neither: Block will be added to today's daily page

Returns:

```json
{
  "success": true,
  "block_uid": "created-block-uid",
  "parent_uid": "parent-page-uid"
}
```

### Create Outline

Create a hierarchical outline with proper nesting and structure:

```typescript
use_mcp_tool roam-research roam_create_outline {
  "outline": [
    {
      "text": "I. Top Level",
      "level": 1
    },
    {
      "text": "A. Second Level",
      "level": 2
    },
    {
      "text": "1. Third Level",
      "level": 3
    }
  ],
  "page_title_uid": "optional-target-page",
  "block_text_uid": "optional-header-text"
}
```

Features:

- Create complex outlines with up to 10 levels of nesting
- Validate outline structure and content
- Maintain proper parent-child relationships
- Optional header block for the outline
- Defaults to today's daily page if no page specified
- Efficient batch operations for creating blocks

Parameters:

- `outline`: Array of outline items, each with:
  - `text`: Content of the outline item (required)
  - `level`: Nesting level (1-10, required)
- `page_title_uid`: Target page title or UID (optional, defaults to today's page)
- `block_text_uid`: Header text for the outline (optional)

Returns:

```json
{
  "success": true,
  "page_uid": "target-page-uid",
  "parent_uid": "header-block-uid",
  "created_uids": ["uid1", "uid2", ...]
}
```

### Add Todo Items

Add one or more todo items to today's daily page:

```typescript
use_mcp_tool roam-research roam_add_todo {
  "todos": [
    "First todo item",
    "Second todo item",
    "Third todo item"
  ]
}
```

Features:

- Adds todos with Roam checkbox syntax (`{{TODO}} todo text`)
- Supports adding multiple todos in a single operation
- Uses batch actions for efficiency when adding >10 todos
- Automatically creates today's page if it doesn't exist
- Adds todos as top-level blocks in sequential order

### Import Nested Markdown

Import nested markdown content under a specific block:

```typescript
use_mcp_tool roam-research roam_import_markdown {
  "content": "- Item 1\n  - Subitem A\n  - Subitem B\n- Item 2",
  "page_uid": "optional-page-uid",
  "page_title": "optional-page-title",
  "parent_uid": "optional-parent-block-uid",
  "parent_string": "optional-exact-block-content",
  "order": "first"
}
```

Features:

- Import content under specific blocks:
  - Find parent block by UID or exact string match
  - Locate blocks within specific pages by title or UID
  - Defaults to today's page if no page specified
- Control content placement:
  - Add as first or last child of parent block
  - Preserve hierarchical structure
  - Efficient batch operations for nested content
- Comprehensive return value:
  ```json
  {
    "success": true,
    "page_uid": "target-page-uid",
    "parent_uid": "parent-block-uid",
    "created_uids": ["uid1", "uid2", ...]
  }
  ```

Parameters:

- `content`: Nested markdown content to import
- `page_uid`: UID of the page containing the parent block
- `page_title`: Title of the page containing the parent block (ignored if page_uid provided)
- `parent_uid`: UID of the parent block to add content under
- `parent_string`: Exact string content of the parent block (must provide either page_uid or page_title)
- `order`: Where to add the content ("first" or "last", defaults to "first")

### Search Block References

Search for block references within pages or across the entire graph:

```typescript
use_mcp_tool roam-research roam_search_block_refs {
  "block_uid": "optional-block-uid",
  "page_title_uid": "optional-page-title-or-uid"
}
```

Features:

- Find all references to a specific block
- Search for any block references within a page
- Search across the entire graph
- Supports both direct and indirect references
- Includes block content and location context

Parameters:

- `block_uid`: UID of the block to find references to (optional)
- `page_title_uid`: Title or UID of the page to search in (optional)

Returns:

```json
{
  "success": true,
  "matches": [
    {
      "block_uid": "referenced-block-uid",
      "content": "Block content with ((reference))",
      "page_title": "Page containing reference"
    }
  ],
  "message": "Found N block(s) referencing..."
}
```

### Search By Text

Search for blocks containing specific text across all pages or within a specific page:

```typescript
use_mcp_tool roam-research roam_search_by_text {
  "text": "search text",
  "page_title_uid": "optional-page-title-or-uid",
  "case_sensitive": true
}
```

Features:

- Search for any text across all blocks in the graph
- Optional page-scoped search
- Case-sensitive or case-insensitive search
- Returns block content with page context
- Efficient text matching using Datalog queries

Parameters:

- `text`: The text to search for (required)
- `page_title_uid`: Title or UID of the page to search in (optional)
- `case_sensitive`: Whether to perform a case-sensitive search (optional, default: true to match Roam's native behavior)

Returns:

```json
{
  "success": true,
  "matches": [
    {
      "block_uid": "matching-block-uid",
      "content": "Block content containing search text",
      "page_title": "Page containing block"
    }
  ],
  "message": "Found N block(s) containing \"search text\""
}
```

### Update Block Content

Update a block's content using either direct text replacement or pattern-based transformations:

```typescript
use_mcp_tool roam-research roam_update_block {
  "block_uid": "target-block-uid",
  "content": "New block content"
}
```

Or use pattern-based transformation:

```typescript
use_mcp_tool roam-research roam_update_block {
  "block_uid": "target-block-uid",
  "transform_pattern": {
    "find": "\\bPython\\b",
    "replace": "[[Python]]",
    "global": true
  }
}
```

Features:

- Two update modes:
  - Direct content replacement
  - Pattern-based transformation using regex
- Verify block existence before updating
- Return updated content in response
- Support for global or single-match replacements
- Preserve block relationships and metadata

Parameters:

- `block_uid`: UID of the block to update (required)
- `content`: New content for the block (if using direct replacement)
- `transform_pattern`: Pattern for transforming existing content:
  - `find`: Text or regex pattern to find
  - `replace`: Text to replace with
  - `global`: Whether to replace all occurrences (default: true)

Returns:

```json
{
  "success": true,
  "content": "Updated block content"
}
```

### Search For Tags

Search for blocks containing specific tags with optional filtering by nearby tags:

```typescript
use_mcp_tool roam-research roam_search_for_tag {
  "primary_tag": "Project/Tasks",
  "page_title_uid": "optional-page-title-or-uid",
  "near_tag": "optional-secondary-tag",
  "case_sensitive": true
}
```

Features:

- Search for blocks containing specific tags
- Optional filtering by presence of another tag
- Page-scoped or graph-wide search
- Case-sensitive or case-insensitive search
- Returns block content with page context
- Efficient tag matching using Datalog queries

Parameters:

- `primary_tag`: The main tag to search for (required)
- `page_title_uid`: Title or UID of the page to search in (optional)
- `near_tag`: Another tag to filter results by (optional)
- `case_sensitive`: Whether to perform case-sensitive search (optional, default: true to match Roam's native behavior)

Returns:

```json
{
  "success": true,
  "matches": [
    {
      "block_uid": "matching-block-uid",
      "content": "Block content containing #[[primary_tag]]",
      "page_title": "Page containing block"
    }
  ],
  "message": "Found N block(s) referencing \"primary_tag\""
}
```

### Remember Information

Store memories or important information with automatic tagging and categorization:

```typescript
use_mcp_tool roam-research roam_remember {
  "memory": "Important information to remember",
  "categories": ["Work", "Project/Alpha"]
}
```

Features:

- Store information with #[[LLM/Memories]] tag
- Add optional category tags for organization
- Automatically adds to today's daily page
- Supports multiple categories per memory
- Easy retrieval using roam_search_for_tag
- Maintains chronological order of memories

Parameters:

- `memory`: The information to remember (required)
- `categories`: Optional array of categories to tag the memory with

Returns:

```json
{
  "success": true,
  "block_uid": "created-block-uid",
  "content": "Memory content with tags"
}
```

### Search By Date

Search for blocks and pages based on creation or modification dates:

```typescript
use_mcp_tool roam-research roam_search_by_date {
  "start_date": "2025-01-01",
  "end_date": "2025-01-31",
  "type": "modified",
  "scope": "blocks",
  "include_content": true
}
```

Features:

- Search by creation date, modification date, or both
- Filter blocks, pages, or both
- Optional date range with start and end dates
- Include or exclude block/page content in results
- Sort results by timestamp
- Efficient date-based filtering using Datalog queries

Parameters:

- `start_date`: Start date in ISO format (YYYY-MM-DD) (required)
- `end_date`: End date in ISO format (YYYY-MM-DD) (optional)
- `type`: Whether to search by 'created', 'modified', or 'both' (required)
- `scope`: Whether to search 'blocks', 'pages', or 'both' (required)
- `include_content`: Whether to include the content of matching blocks/pages (optional, default: true)

Returns:

```json
{
  "success": true,
  "matches": [
    {
      "uid": "block-or-page-uid",
      "type": "block",
      "time": 1704067200000,
      "content": "Block or page content",
      "page_title": "Page title (for blocks)"
    }
  ],
  "message": "Found N matches for the given date range and criteria"
}
```

### Find Pages Modified Today

Find all pages that have been modified since midnight today:

```typescript
use_mcp_tool roam-research find_pages_modified_today {}
```

Features:

- Tracks all modifications made to pages since midnight
- Detects changes at any level in the block hierarchy
- Returns unique list of modified page titles
- Includes count of modified pages
- No parameters required

Returns:

```json
{
  "success": true,
  "pages": ["Page 1", "Page 2"],
  "message": "Found 2 page(s) modified today"
}
```

### Execute Datomic Queries

Execute custom Datalog queries on your Roam graph for advanced data retrieval and analysis:

```typescript
use_mcp_tool roam-research roam_datomic_query {
  "query": "[:find (count ?p)\n :where [?p :node/title]]",
  "inputs": []
}
```

Features:

- Direct access to Roam's query engine
- Support for all Datalog query features:
  - Complex pattern matching
  - Aggregation functions (count, sum, max, min, avg, distinct)
  - String operations (includes?, starts-with?, ends-with?)
  - Logical operations (<, >, <=, >=, =, not=)
  - Rules for recursive queries
- Case-sensitive and case-insensitive search capabilities
- Efficient querying across the entire graph

Parameters:

- `query`: The Datalog query to execute (required)
- `inputs`: Optional array of input parameters for the query

Returns:

```json
{
  "success": true,
  "matches": [
    {
      "content": "[result data]",
      "block_uid": "",
      "page_title": ""
    }
  ],
  "message": "Query executed successfully. Found N results."
}
```

Example Queries:

1. Count all pages:

```clojure
[:find (count ?p)
 :where [?p :node/title]]
```

2. Case-insensitive text search:

```clojure
[:find ?string ?title
 :where
 [?b :block/string ?string]
 [(clojure.string/lower-case ?string) ?lower]
 [(clojure.string/includes? ?lower "search term")]
 [?b :block/page ?p]
 [?p :node/title ?title]]
```

3. Find blocks modified after a date:

```clojure
[:find ?block_ref ?string
 :in $ ?start_of_day
 :where
 [?b :edit/time ?time]
 [(> ?time ?start_of_day)]
 [?b :block/uid ?block_ref]
 [?b :block/string ?string]]
```

See Roam_Research_Datalog_Cheatsheet.md for more query examples and syntax documentation.

### Search Block Hierarchy

Navigate and search through block parent-child relationships:

```typescript
use_mcp_tool roam-research roam_search_hierarchy {
  "parent_uid": "optional-parent-block-uid",
  "child_uid": "optional-child-block-uid",
  "page_title_uid": "optional-page-title-or-uid",
  "max_depth": 3
}
```

Features:

- Search up or down the block hierarchy
- Find children of a specific block
- Find parents of a specific block
- Configure search depth (1-10 levels)
- Optional page scope filtering
- Includes depth information for each result

Parameters:

- `parent_uid`: UID of the block to find children of (required if searching down)
- `child_uid`: UID of the block to find parents of (required if searching up)
- `page_title_uid`: Title or UID of the page to search in (optional)
- `max_depth`: How many levels deep to search (optional, default: 1, max: 10)

Returns:

```json
{
  "success": true,
  "matches": [
    {
      "block_uid": "related-block-uid",
      "content": "Block content",
      "depth": 2,
      "page_title": "Page containing block"
    }
  ],
  "message": "Found N block(s) as children/parents..."
}
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
