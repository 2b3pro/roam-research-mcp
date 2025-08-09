![](./roam-research-mcp-image.jpeg)

# Roam Research MCP Server

[![npm version](https://badge.fury.io/js/roam-research-mcp.svg)](https://badge.fury.io/js/roam-research-mcp)
[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/github/license/2b3pro/roam-research-mcp)](https://github.com/2b3pro/roam-research-mcp/blob/main/LICENSE)

A Model Context Protocol (MCP) server that provides comprehensive access to Roam Research's API functionality. This server enables AI assistants like Claude to interact with your Roam Research graph through a standardized interface. It supports standard input/output (stdio), HTTP Stream, and Server-Sent Events (SSE) communication. (A WORK-IN-PROGRESS, personal project not officially endorsed by Roam Research)

<a href="https://glama.ai/mcp/servers/fzfznyaflu"><img width="380" height="200" src="https://glama.ai/mcp/servers/fzfznyaflu/badge" alt="Roam Research MCP server" /></a>
<a href="https://mseep.ai/app/2b3pro-roam-research-mcp"><img width="380" height="200" src="https://mseep.net/pr/2b3pro-roam-research-mcp-badge.png" alt="MseeP.ai Security Assessment Badge" /></a>

## Installation and Usage

This MCP server supports three primary communication methods:

1.  **Stdio (Standard Input/Output):** Ideal for local inter-process communication, command-line tools, and direct integration with applications running on the same machine. This is the default communication method when running the server directly.
2.  **HTTP Stream:** Provides network-based communication, suitable for web-based clients, remote applications, or scenarios requiring real-time updates over HTTP. The HTTP Stream endpoint runs on port `8088` by default.
3.  **SSE (Server-Sent Events):** A transport for legacy clients that require SSE. The SSE endpoint runs on port `8087` by default. (NOTE: ⚠️ DEPRECATED: The SSE Transport has been deprecated as of MCP specification version 2025-03-26. HTTP Stream Transport preferred.)

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

To run the server with HTTP Stream or SSE support, you can either:

1.  **Use the default ports:** Run `npm start` after building (as shown above). The server will automatically listen on port `8088` for HTTP Stream and `8087` for SSE.
2.  **Specify custom ports:** Set the `HTTP_STREAM_PORT` and/or `SSE_PORT` environment variables before starting the server.

    ```bash
    HTTP_STREAM_PORT=9000 SSE_PORT=9001 npm start
    ```

    Or, if using a `.env` file, add `HTTP_STREAM_PORT=9000` and/or `SSE_PORT=9001` to it.

## Docker

This project can be easily containerized using Docker. A `Dockerfile` is provided at the root of the repository.

### Build the Docker Image

To build the Docker image, navigate to the project root and run:

```bash
docker build -t roam-research-mcp .
```

### Run the Docker Container

To run the Docker container and map the necessary ports, you must also provide the required environment variables. Use the `-e` flag to pass `ROAM_API_TOKEN`, `ROAM_GRAPH_NAME`, and optionally `MEMORIES_TAG`, `HTTP_STREAM_PORT`, and `SSE_PORT`:

```bash
docker run -p 3000:3000 -p 8088:8088 -p 8087:8087 \
  -e ROAM_API_TOKEN="your-api-token" \
  -e ROAM_GRAPH_NAME="your-graph-name" \
  -e MEMORIES_TAG="#[[LLM/Memories]]" \
  -e CUSTOM_INSTRUCTIONS_PATH="/path/to/your/custom_instructions_file.md" \
  -e HTTP_STREAM_PORT="8088" \
  -e SSE_PORT="8087" \
  roam-research-mcp
```

Alternatively, if you have a `.env` file in the project root (which is copied into the Docker image during build), you can use the `--env-file` flag:

```bash
docker run -p 3000:3000 -p 8088:8088 --env-file .env roam-research-mcp
```

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
3. `roam_create_page`: Create new pages with optional content and headings. Now creates a block on the daily page linking to the newly created page.
4. `roam_import_markdown`: Import nested markdown content under a specific block. (Internally uses `roam_process_batch_actions`.)
5. `roam_add_todo`: Add a list of todo items to today's daily page. (Internally uses `roam_process_batch_actions`.)
6. `roam_create_outline`: Add a structured outline to an existing page or block, with support for `children_view_type`. Best for simpler, sequential outlines. For complex nesting (e.g., tables), consider `roam_process_batch_actions`. If `page_title_uid` and `block_text_uid` are both blank, content defaults to the daily page. (Internally uses `roam_process_batch_actions`.)
7. `roam_search_block_refs`: Search for block references within a page or across the entire graph.
8. `roam_search_hierarchy`: Search for parent or child blocks in the block hierarchy.
9. `roam_find_pages_modified_today`: Find pages that have been modified today (since midnight).
10. `roam_search_by_text`: Search for blocks containing specific text.
11. `roam_search_by_status`: Search for blocks with a specific status (TODO/DONE) across all pages or within a specific page.
12. `roam_search_by_date`: Search for blocks or pages based on creation or modification dates.
13. `roam_search_for_tag`: Search for blocks containing a specific tag and optionally filter by blocks that also contain another tag nearby.
14. `roam_remember`: Add a memory or piece of information to remember. (Internally uses `roam_process_batch_actions`.)
15. `roam_recall`: Retrieve all stored memories.
16. `roam_datomic_query`: Execute a custom Datomic query on the Roam graph for advanced data retrieval beyond the available search tools.
17. `roam_markdown_cheatsheet`: Provides the content of the Roam Markdown Cheatsheet resource, optionally concatenated with custom instructions if `CUSTOM_INSTRUCTIONS_PATH` environment variable is set.
18. `roam_process_batch_actions`: Execute a sequence of low-level block actions (create, update, move, delete) in a single, non-transactional batch. Provides granular control for complex nesting like tables. (Note: For actions on existing blocks or within a specific page context, it is often necessary to first obtain valid page or block UIDs using tools like `roam_fetch_page_by_title`.)

**Deprecated Tools**:
The following tools have been deprecated as of `v.0.30.0` in favor of the more powerful and flexible `roam_process_batch_actions`:

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

This demonstrates moving a block from one location to another and simultaneously updating its content.

```
"In Roam, add a new table on the page "Fruity Tables" that compares four types of fruits: apples, oranges, grapes, and dates. Choose randomly four areas to compare."
```

---

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
   CUSTOM_INSTRUCTIONS_PATH='/path/to/your/custom_instructions_file.md'
   HTTP_STREAM_PORT=8088 # Or your desired port for HTTP Stream communication
   SSE_PORT=8087 # Or your desired port for SSE communication
   ```

   Option 2: Using MCP settings (Alternative method)
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
           "HTTP_STREAM_PORT": "8088",
           "SSE_PORT": "8087"
         }
       }
     }
   }
   ```

   Note: The server will first try to load from .env file, then fall back to environment variables from MCP settings.

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
