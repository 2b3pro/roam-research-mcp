# Changelog

v2.3.0 - 2026-01-04

- ADDED: `roam rename` CLI command to rename pages
  - `roam rename "Old Title" "New Title"` - rename by current title
  - `roam rename --uid abc123def "New Title"` - rename by page UID
  - Supports multi-graph mode with `-g` and `--write-key` flags
- ADDED: `roam_rename_page` MCP tool
  - Parameters: `old_title` OR `uid` to identify page, `new_title` (required)
  - Returns: `{ success, message }`
- ADDED: `updatePage` SDK function type declaration for page operations
- ENHANCED: `RoamBatchAction` type now includes page actions (`create-page`, `update-page`, `delete-page`)

v2.2.0 - 2026-01-03

- ADDED: Datalog query support in `roam search` CLI command
  - `-q, --query <datalog>` - Execute raw Datalog queries directly from CLI
  - `--inputs <json>` - JSON array of inputs for parameterized queries
  - `--regex <pattern>` - Client-side regex filter on results
  - `--regex-flags <flags>` - Regex flags (e.g., "i" for case-insensitive)
  - Examples: `roam search -q '[:find ?title :where [?e :node/title ?title]]'`
- ENHANCED: `roam batch` CLI command reliability
  - `--simulate` mode for offline validation (no API calls)
  - Upfront placeholder validation catches `{{ref}}` errors before execution
  - Partial results output on failure shows created pages for manual cleanup
  - Better error messages with action index and field details

v2.1.0 - 2026-01-03

- ADDED: `roam batch` CLI command for executing multiple operations in a single API call
  - Reduces rate limit issues by batching operations
  - Supports 10 command types: `create`, `update`, `delete`, `move`, `todo`, `table`, `outline`, `remember`, `page`, `codeblock`
  - Placeholder references (`{{name}}`) for cross-command dependencies
  - Automatic page title resolution (with parallel lookups)
  - Daily page auto-resolution for `todo` and `remember` commands
  - Level-based hierarchy for `outline` command
  - Table expansion to nested Roam structure
  - `--dry-run` mode for validating without execution
  - `--debug` mode for troubleshooting
  - Full spec: [docs/batch-cli-spec.md](docs/batch-cli-spec.md)

v2.0.2 - 2026-01-03

- CHANGED: `roam_create_page` now adds "Processed: [[date]]" as last block on the new page
  - Replaces the previous behavior of adding "Created page: [[title]]" to today's daily page
  - The "Processed: [[date]]" block naturally links back to today's daily page
  - Removed `skip_daily_page_link` parameter from MCP tool
  - Removed `--no-daily-page` flag from CLI `roam save` command

v2.0.1 - 2026-01-03

- ADDED: `skip_daily_page_link` parameter to `roam_create_page` MCP tool (removed in v2.0.2)
  - When `true`, skips adding the "Created page: [[title]]" block to today's daily page
  - Defaults to `false` (preserves existing behavior)
  - Useful for programmatic page creation where daily page logging is unnecessary

v1.9.1 - 2026-01-02

- Updated: Added --heading to `roam save` CLI

v1.9.0 - 2026-01-02

- ADDED: `roam_move_block` MCP tool
  - Standalone tool for moving a block to a new parent or position
  - Parameters: `block_uid` (required), `parent_uid` (required), `order` (optional, defaults to "last")
  - Convenience wrapper around `roam_process_batch_actions` for single block moves
  - Validates block existence before attempting move
  - Returns: `{ success, block_uid, new_parent_uid, order }`

v1.8.2 - 2026-01-02

feat(cli): add --no-daily-page flag to roam save command (removed in v2.0.2)

Introduces the `--no-daily-page` flag to the save command, allowing users
to create pages without automatically linking them on the current Daily Page.
This is useful for programmatic generation or workflows where a daily log
entry is unnecessary. (Note: This feature was removed in v2.0.2 - pages now
add a "Processed: [[date]]" block at the end instead of linking from daily page.)

Changes:
- Update `save` command to pass `noDailyPage` option to page operations.
- Refactor `createPage` to conditionally skip the daily page link logic.
- Tweak `MemoryOperations` to place the memory tag at the end of the block
  content rather than the beginning.
- Update CHANGELOG.md.

v1.8.1 - 2026-01-02

- ADDED: `roam update` CLI command to update block content by UID
  - `roam update <uid> "New content"` - Update any block
  - Useful for marking TODOs as DONE: `roam update <uid> "{{[[DONE]]}} ..."`
- ADDED: `--parent <uid>` option to `roam save -b` for nested block creation
  - Create blocks under a specific parent block UID
  - `roam save -b "Child content" --parent <parent-uid>`
- ADDED: `--json` input mode for `roam save` with explicit nesting control
  - Input format: `[{text, level, heading?}]`
  - `echo '[{"text":"Block","level":1}]' | roam save --json --title "Page"`
  - Provides precise control over indentation levels
- ADDED: `--no-daily-page` flag to `roam save` to skip "Created page" link (removed in v2.0.2)
  - Useful when linking to the page from another location (e.g., brainstorm workflows)
  - `roam save content.md --title "Page" --no-daily-page`
- ENHANCED: CLI help text clarifies `-i`/`-e` filter on text content, not tags

v1.8.0 - 2026-01-02

- ADDED: TODO/DONE support in CLI commands
  - `roam get --todo` - Fetch all TODO items across the graph
  - `roam get --done` - Fetch all DONE items across the graph
  - `roam get --todo -p "Page Title"` - Filter by page
  - `roam get --todo -i "term1,term2"` - Include filter (text content only, not tags)
  - `roam get --todo -e "term1,term2"` - Exclude filter (text content only, not tags)
  - `roam save --todo "Task text"` - Create TODO on daily page
  - `echo "Task" | roam save --todo` - Create TODO from stdin
  - Multiple TODOs supported via newline-separated input
- FIXED: TODO search now finds both `{{[[TODO]]}}` and `{{TODO}}` formats
  - Roam API normalizes `{{[[TODO]]}}` to `{{TODO}}` in storage
  - Search query updated to match prefix `{{TODO` for compatibility
- ENHANCED: TODO output formatting
  - Results grouped by page with markdown headers
  - Clean checkbox format: `- [ ] Task (uid)` / `- [x] Done (uid)`
  - Strips TODO/DONE markers from display for readability
  - JSON output available with `--json` flag

v1.7.0 - 2026-01-01

- ADDED: Nested table support in `roam_create_page`
  - Tables with `level: 2` or higher are now created as children of preceding text blocks
  - Uses UID tracking to map each level to its most recent block
  - Tables at level N become children of the last block created at level N-1
  - If no parent found at the expected level, tables fall back to page level

v1.6.2 - 2026-01-01

- FIXED: `roam_create_page` table ordering bug
  - Tables in mixed content were being created at the end of the page instead of inline at their original positions
  - Root cause: Content processing separated text and tables into two sequential batches rather than preserving original order
  - Solution: Refactored to process content items in order, flushing pending text batches before each table insertion
  - Tables now appear correctly after their preceding headings when using the `content` array with mixed types

v1.6.0 - 2025-12-31

- ADDED: `roam refs` CLI command to find blocks referencing a page or block
  - Accepts page titles, `#tags`, `[[Page Names]]`, or `((block UIDs))`
  - Three output formats: grouped by page (default), `--json` for LLM/programmatic use, `--raw` for piping
  - `-n, --limit` option to control number of results (default: 50)
- ENHANCED: `roam_search_block_refs` MCP tool with new `title` parameter
  - Find blocks referencing a page title using Roam's `:block/refs` attribute
  - Captures both `[[page]]` links and `#tag` references semantically
  - Existing `block_uid` parameter continues to work for `((uid))` pattern searches

v1.5.0 - 2025-12-31

- ADDED: Unified `roam` CLI with three subcommands
  - `roam get` - Fetch pages by title or blocks by UID
    - `--json` for machine-readable output, `--depth` for child levels, `--flat` for flattened hierarchy
    - Accepts both `((uid))` and bare 9-character UIDs
  - `roam search` - Full-text and tag-based search
    - `--tag` for tag filtering, `--page` for page scope, `-i` for case-insensitive, `-n` for result limit
  - `roam save` - Import markdown to Roam (replaces `roam-import`)
    - `--title` for explicit page title, `--update` for smart diff mode preserving block UIDs
    - Supports both file input and stdin piping
- REMOVED: `roam-import` standalone CLI (functionality merged into `roam save`)
- ADDED: `commander.js` dependency for robust CLI argument parsing
- UPDATED: Package binary from `roam-import` to `roam`

v1.4.0 - 2025-12-30

- ADDED: `roam_update_page_markdown` tool
  - Updates existing pages with new markdown content using smart diff algorithm
  - Preserves block UIDs where possible, keeping references intact across the graph
  - Three-phase block matching: exact text → normalized (removes list prefixes) → position-based fallback
  - Generates minimal batch operations: only creates/updates/moves/deletes what changed
  - Supports `dry_run` parameter to preview changes without executing them
  - Returns detailed stats: creates, updates, moves, deletes, and preserved UIDs
  - Ideal for: syncing external markdown to Roam, AI-assisted content updates, batch modifications
- ADDED: Unit test infrastructure with Vitest
  - Added `npm run test` and `npm run test:watch` scripts
  - 71 tests covering diff module: matcher, parser, diff computation, action generation
  - Tests document expected behavior of three-phase matching algorithm

v1.3.2 - 2025-12-27

- FIXED: Content duplication bug in `roam_create_page`
  - Added idempotency check to prevent duplicate content when tool is called multiple times
  - Root cause: Duplicate tool invocations (e.g., SSE transport retries, client timeouts) caused content to be created twice
  - If page already has child blocks, subsequent calls return success without adding duplicate content
  - Added test script: `scripts/test-create-page-duplication.ts`

v1.3.1 - 2025-12-27

- ENHANCED: `Roam_Markdown_Cheatsheet.md` attribute usage guidance
  - Added clear rules for when to use `::` attribute syntax vs bold formatting
  - Attributes are for queryable metadata across the graph (Type::, Author::, Status::)
  - Bold formatting (`**Label:**`) should be used for page-specific labels (Step 1:, Summary:)
  - Added "The Test" decision guide: "Will I ever query for this across my graph?"
  - Added attribute anti-pattern to the DON'T DO THIS section

v1.3.0 - 2025-12-26

- ADDED: `roam_create_table` tool
  - Abstracts Roam's complex nested table structure into simple headers/rows input
  - Validates row/column consistency before execution
  - Converts empty cells to spaces (required by Roam)
  - Returns table_uid on success
- ADDED: Pre-validation for batch actions
  - Validates all actions before API execution, catching errors early
  - Checks action types, UIDs, strings, locations, and placeholder references
  - Returns structured error details with action index and field info
- FIXED: Transaction reporting accuracy
  - `uid_map` only returned on successful transactions (was incorrectly returned on failure)
  - Prevents LLMs from using invalid UIDs for failed operations
- ENHANCED: Structured error responses
  - New error codes: VALIDATION_ERROR, RATE_LIMIT, TRANSACTION_FAILED
  - Includes recovery suggestions and retry timing for rate limits
- ADDED: Rate limit retry with exponential backoff
  - Up to 3 retries with configurable delays (1s initial, 2x multiplier, 60s max)
  - Automatic handling of 429 responses from Roam API
- ENHANCED: `roam_create_page` now supports mixed content types
  - Content array can now include both text blocks and tables
  - Tables use `{type: "table", level, headers, rows}` format
  - Reduces MCP calls when creating pages with mixed content (2+ calls → 1 call)
  - Text blocks remain default (no type field needed for backward compatibility)

v1.2.2 - 2025-12-24
- ENHANCED: CORS support for HTTP streaming endpoint
  - Now supports multiple CORS origins (comma-separated in `CORS_ORIGIN` env var)
  - Default origins include `http://localhost:5678` and `https://roamresearch.com`
  - Enables browser-based MCP clients (like Roam extensions) to connect to the server
  - Added `Access-Control-Allow-Credentials` header for authenticated requests

v1.2.1 - 2025-12-20
- ENHANCED: `roam_create_outline` tool to not create empty blocks

v1.2.0 - 2025-12-20

- ADDED: Server-side UID placeholder system for batch operations
  - Use `{{uid:name}}` syntax in batch actions; server generates proper random UIDs
  - Returns `uid_map` in response showing placeholder → generated UID mappings
  - Solves LLM random generation unreliability (LLMs can't generate truly random strings)
  - Exported `generateBlockUid()` function for use across modules
- ADDED: Page UID cache to reduce redundant API queries
  - Server-side in-memory cache for page title → UID mappings
  - Eliminates repeated lookups for the same pages across operations
- OPTIMIZED: Reduced API calls during verification after batch operations
  - Conditional verification based on batch size (threshold: 5 items)
  - For large batches, skips recursive child fetching to minimize queries
  - Reduced retry attempts in block lookup from 15 to 2 per block
- ENHANCED: Tool descriptions with rate-limit efficiency guidance
  - `roam_process_batch_actions`: Marked as most API-efficient for multiple operations
  - `roam_create_outline` / `roam_import_markdown`: Added API usage notes
  - `roam_create_page`: Added efficiency tips
- ENHANCED: `Roam_Markdown_Cheatsheet.md` with API Efficiency Guidelines section
  - Tool efficiency ranking (best to worst)
  - Best practices for intensive operations and page revisions
  - UID caching tips for LLM usage

v1.1.0 - 2025-12-19

- ADDED: `roam-import` standalone CLI tool for importing markdown to Roam
  - Reads markdown from stdin and creates a new page with the specified title
  - Automatically links the new page from today's daily page
  - Usage: `cat document.md | roam-import "Page Title"` or `pbpaste | roam-import "Ideas"`
  - If page exists, content is appended to it
- FIXED: Markdown parser now handles variable indentation (2 spaces, 4 spaces, tabs)
  - Previously assumed 2-space indentation, causing nested items to flatten to root
  - Now dynamically detects indentation levels from the document

v1.0.0 - 2025-12-16

- OPTIMIZED: Server performance and reliability
  - Removed deprecated and non-functional SSE (Server-Sent Events) server implementation.
  - Implemented async file reading and caching for Roam Markdown Cheatsheet and custom instructions to avoid blocking the event loop.
  - Optimized `roam_fetch_page_by_title` to use a single Datomic query for all title variations (original, capitalized, lowercase) instead of sequential queries.
  - Replaced insecure `Math.random` with `crypto.randomBytes` for more robust block UID generation.
  - Added error logging to stderr for better debugging of server startup failures.
  - Refactored `RoamServer` to reduce code duplication in server initialization.

v0.36.4 - 2025-10-03

- FIXED: SSE server implementation on port 8087
  - Added missing SSE server setup in `src/server/roam-server.ts` that was previously imported but never instantiated
  - SSE server now properly creates its own MCP server instance with full tool capabilities
  - Configured CORS headers and preflight OPTIONS request handling for SSE endpoint
  - SSE server listens on port 8087 (or next available port) with proper error handling

v0.36.3 - 2025-08-30

- FEATURE: Implemented `prompts/list` method for MCP server, returning an empty array of prompts.
- FIXED: Removed `roam-markdown-cheatsheet.md` from advertised resources in MCP server capabilities to align with its tool-only access.

v0.36.2 - 2025-08-28

- ENHANCED: `roam_datomic_query` tool
  - Added `regexFilter`, `regexFlags`, and `regexTargetField` parameters for client-side regex filtering of results.
  - Updated description to reflect enhanced filtering capabilities.

v0.36.1 - 2025-08-28

- ENHANCED: `roam_find_pages_modified_today` tool
  - Added `limit`, `offset`, and `sort_order` parameters for pagination and sorting.

v1.36.0 - 2025-08-28

- ENHANCED: `roam_search_for_tag` and `roam_search_by_text` tools
  - Added `offset` parameter for pagination support.
- ENHANCED: `roam_search_for_tag` tool
  - Implemented `near_tag` and `exclude_tag` parameters for more precise tag-based filtering.
- ENHANCED: `roam_datomic_query` tool
  - Updated description to clarify optimal use cases (Regex, Complex Boolean Logic, Arbitrary Sorting, Proximity Search).

v.0.35.1 - 2025-08-23 9:33

- ENHANCED: `roam_create_page` and `roam_create_outline` tool descriptions in `src/tools/schemas.ts` for improved clarity and to guide users toward the most efficient workflow.

v.0.35.0 - 2025-08-23 

- ENHANCED: `roam_import_markdown` tool
  - Now returns a nested object structure for `created_uids`, reflecting the hierarchy of the imported content, including `uid`, `text`, `order`, and `children`.
  - If a `parent_string` is provided and the block does not exist, it will be created automatically.
- FIXED: Block ordering issue in `roam_import_markdown` and `roam_create_outline`. Nested outlines are now created in the correct order.
- FIXED: Duplication issue in the response of `roam_fetch_block_with_children`.

v.0.32.4

- FIXED: Memory allocation issue (`FATAL ERROR: invalid array length Allocation failed - JavaScript heap out of memory`)
  - Removed `console.log` statements from `src/tools/operations/outline.ts` to adhere to MCP server stdio communication rules.
  - Optimized `parseMarkdown` function in `src/markdown-utils.ts` to avoid inefficient `lines.splice()` operations when handling mid-line code blocks, improving memory usage and performance.
- ENHANCED: `roam_create_outline` tool
  - Successfully created outlines with nested code blocks, confirming the fix for memory allocation issues.

v.0.32.1

- ENHANCED: `roam_create_outline` tool
  - The tool now returns a nested structure of UIDs (`NestedBlock[]`) for all created blocks, including children, accurately reflecting the outline hierarchy.
  - Implemented a recursive fetching mechanism (`fetchBlockWithChildren` helper) to retrieve all nested block UIDs and their content after creation.
  - Fixed an issue where the `created_uids` array was only returning top-level block UIDs.
  - Corrected the Datomic query used for fetching children to ensure only direct children are retrieved, resolving previous duplication and incorrect nesting issues.
  - Removed `console.log` and `console.warn` statements from `src/tools/operations/outline.ts` to adhere to MCP server stdio communication rules.
- ADDED: `NestedBlock` interface in `src/tools/types/index.ts` to represent the hierarchical structure of created blocks.

v.0.32.3

- ENHANCED: `roam_create_page` tool
  - Now creates a block on the daily page linking to the newly created page, formatted as `Create [[Page Title]]`.

v.0.32.2

- FIXED: `roam_create_outline` now correctly respects the order of top-level blocks.
  - Changed the default insertion order for batch actions from 'first' to 'last' in `src/tools/operations/outline.ts` to ensure blocks are added in the intended sequence.

v.0.30.10

- ENHANCED: `roam_markdown_cheatsheet` tool
  - The tool now reads the `Roam_Markdown_Cheatsheet.md` and concatenates it with custom instructions from the path specified by the `CUSTOM_INSTRUCTIONS_PATH` environment variable, if the file exists. If the custom instructions file is not found, only the cheatsheet content is returned.
- UPDATED: The description of `roam_markdown_cheatsheet` in `src/tools/schemas.ts` to reflect the new functionality.

v.0.30.9

- FIXED: `roam_fetch_block_with_children` tool to use a more efficient batched recursive approach, avoiding "Too many requests" and other API errors.
- The tool now fetches all children of a block in a single query per level of depth, significantly reducing the number of API calls.

v.0.30.8

- ADDED: `roam_fetch_block_with_children` tool
  - Fetches a block by its UID along with its hierarchical children down to a specified depth.
  - Automatically handles Roam's `((UID))` formatting, extracting the raw UID for lookup.
  - This tool provides a direct and structured way to retrieve specific block content and its nested hierarchy.

v.0.30.7

- FIXED: `roam_create_outline` now prevents errors from invalid outline structures by enforcing that outlines must start at level 1 and that subsequent levels cannot increase by more than 1 at a time.
  - Updated the tool's schema in `src/tools/schemas.ts` with more explicit instructions to guide the LLM in generating valid hierarchical structures.
  - Added stricter validation in `src/tools/operations/outline.ts` to reject outlines that do not start at level 1, providing a clearer error message.
  - Optimized page creation

v.0.30.6

- FIXED: `roam_create_page` now correctly strips heading markers (`#`) from block content before creation.
- FIXED: Block creation order is now correct. Removed the incorrect `.reverse()` call in `convertToRoamActions` and the corresponding workaround in `createBlock`.
- UPDATED: the cheat sheet for ordinal dates.

v.0.30.5

- FIXED: `roam_search_for_tag` now correctly scopes searches to a specific page when `page_title_uid` is provided.
  - The Datalog query in `src/search/tag-search.ts` was updated to include the `targetPageUid` in the `where` clause.

v.0.30.4

- FIXED: Tools not loading properly in Gemini CLI
- Clarified outline description
- FIXED: `roam_process_batch_actions` `heading` enum type in `schemas.ts` for Gemini CLI compatibility.

v.0.30.3

- ADDED: `roam_markdown_cheatsheet` tool
  - Provides the content of the Roam Markdown Cheatsheet directly via a tool call.
  - The content is now read dynamically from `Roam_Markdown_Cheatsheet.md` on the filesystem.
  - **Reason for Tool Creation:** While Cline can access local resources provided by an MCP server, other AI models (suchs as Claude AI) may not have this capability. By exposing the cheatsheet as a tool, it ensures broader accessibility and utility for all connected AI models, allowing them to programmatically request and receive the cheatsheet content when needed.
- REMOVED: Roam Markdown Cheatsheet as a direct resource
  - The cheatsheet is no longer exposed as a static resource; it is now accessed programmatically through the new `roam_markdown_cheatsheet` tool.
- ADDED: package.json new utilty scripts

v.0.30.2

- ADDED: 4x4 table creation example
  - Created a 4x4 table with random data on the "Testing Tables" page, demonstrating proper Roam table structure.
- ENHANCED: `Roam_Markdown_Cheatsheet.md`
  - Updated the "Roam Tables" section with a more detailed explanation of table structure, including proper indentation levels for headers and data cells.
- ENHANCED: `src/tools/schemas.ts`
  - Clarified the distinction between `roam_create_outline` and `roam_process_batch_actions` in their respective descriptions, providing guidance on their best use cases.

v.0.30.1

- ENHANCED: `roam_process_batch_actions` tool description
  - Clarified that Roam-flavored markdown, including block embedding with `((UID))` syntax, is supported within the `string` property for `create-block` and `update-block` actions.
  - Added a note advising users to obtain valid page or block UIDs using `roam_fetch_page_by_title` or other search tools for actions on existing blocks or within a specific page context.
  - Clarified the `block_text_uid` description for `roam_create_outline` to explicitly mention defaulting to the daily page.
  - Simplified the top-level description for `roam_datomic_query`.
  - Refined the introductory sentence for `roam_datomic_query`.
- ADDED: "Example Prompts" section in `README.md`
  - Provided 2-3 examples demonstrating how to prompt an LLM to use the Roam tool, specifically leveraging `roam_process_batch_actions` for creative use cases.

v.0.30.0

- DEPRECATED: **Generic Block Manipulation Tools**:
  - `roam_create_block`: Deprecated in favor of `roam_process_batch_actions` (action: `create-block`).
  - `roam_update_block`: Deprecated in favor of `roam_process_batch_actions` (action: `update-block`).
  - `roam_update_multiple_blocks`: Deprecated in favor of `roam_process_batch_actions` for batch updates.
    Users are encouraged to use `roam_process_batch_actions` for all direct, generic block manipulations due to its enhanced flexibility and batch processing capabilities.
- REFACTORED: `roam_add_todo` to internally use `roam_process_batch_actions` for all block creations, enhancing efficiency and consistency.
- REFACTORED: `roam_remember` to internally use `roam_process_batch_actions` for all block creations, enhancing efficiency and consistency.
- ENHANCED: `roam_create_outline`
  - Refactored to internally use `roam_process_batch_actions` for all block creations, including parent blocks.
  - Added support for `children_view_type` in outline items, allowing users to specify the display format (bullet, document, numbered) for nested blocks.
- REFACTORED: `roam_import_markdown` to internally use `roam_process_batch_actions` for all content imports, enhancing efficiency and consistency.

v.0.29.0

- ADDED: **Batch Processing Tool**: Introduced `roam_process_batch_actions`, a powerful new tool for executing a sequence of low-level block actions (create, update, move, delete) in a single API call. This enables complex, multi-step workflows, programmatic content reorganization, and high-performance data imports.
- ENHANCED: **Schema Clarity**: Updated the descriptions for multiple tool parameters in `src/tools/schemas.ts` to explicitly state that using a block or page UID is preferred over text-based identifiers for improved accuracy and reliability.
- NOTE: **Heading Removal Limitation**: Discovered that directly removing heading formatting (e.g., setting `heading` to `0` or `null`) via `update-block` action in `roam_process_batch_actions` is not supported by the Roam API. The `heading` attribute persists its value.

v.0.28.0

- ADDED: **Configurable HTTP and SSE Ports**: The HTTP and SSE server ports can now be configured via environment variables (`HTTP_STREAM_PORT` and `SSE_PORT`).
- ADDED: **Automatic Port Conflict Resolution**: The server now automatically checks if the desired ports are in use and finds the next available ports, preventing startup errors due to port conflicts.

v.0.27.0

- ADDED: SSE (Server-Sent Events) transport support for legacy clients.
- REFACTORED: `src/server/roam-server.ts` to use separate MCP `Server` instances for each transport (Stdio, HTTP Stream, and SSE) to ensure they can run concurrently without conflicts.
- ENHANCED: Each transport now runs on its own isolated `Server` instance, improving stability and preventing cross-transport interference.
- UPDATED: `src/config/environment.ts` to include `SSE_PORT` for configurable SSE endpoint (defaults to `8087`).

v.0.26.0

- ENHANCED: Added HTTP Stream Transport support
- Implemented dual transport support for Stdio and HTTP Stream, allowing communication via both local processes and network connections.
- Updated `src/config/environment.ts` to include `HTTP_STREAM_PORT` for configurable HTTP Stream endpoint.
- Modified `src/server/roam-server.ts` to initialize and connect `StreamableHTTPServerTransport` alongside `StdioServerTransport`.
- Configured HTTP server to listen on `HTTP_STREAM_PORT` and handle requests via `StreamableHTTPServerTransport`.

v.0.25.7

- FIXED: `roam_fetch_page_by_title` schema definition
- Corrected missing `name` property and proper nesting of `inputSchema` in `src/tools/schemas.ts`.
- ENHANCED: Dynamic tool loading and error reporting
- Implemented dynamic loading of tool capabilities from `toolSchemas` in `src/server/roam-server.ts` to ensure consistency.
- Added robust error handling during server initialization (graph, tool handlers) and connection attempts in `src/server/roam-server.ts` to provide more specific feedback on startup issues.
- CENTRALIZED: Versioning in `src/server/roam-server.ts`
- Modified `src/server/roam-server.ts` to dynamically read the version from `package.json`, ensuring a single source of truth for the project version.

v.0.25.6

- ADDED: Docker support
- Created a `Dockerfile` for containerization.
- Added an `npm start` script to `package.json` for running the application within the Docker container.

v.0.25.5

- ENHANCED: `roam_create_outline` tool for better heading and nesting support
- Reverted previous change in `src/tools/operations/outline.ts` to preserve original indentation for outline items.
- Refined `parseMarkdown` in `src/markdown-utils.ts` to correctly parse markdown heading syntax (`#`, `##`, `###`) while maintaining the block's hierarchical level based on indentation.
- Updated `block_text_uid` description in `roam_create_outline` schema (`src/tools/schemas.ts`) to clarify its use for specifying a parent block by text or UID.
- Clarified that `roam_create_block` creates blocks directly on a page and does not support nesting under existing blocks. `roam_create_outline` should be used for this purpose.

v.0.25.4

- ADDED: `format` parameter to `roam_fetch_page_by_title` tool
- Allows fetching page content as raw JSON data (blocks with UIDs) or markdown.
- Updated `fetchPageByTitle` in `src/tools/operations/pages.ts` to return stringified JSON for raw format.
- Updated `roam_fetch_page_by_title` schema in `src/tools/schemas.ts` to include `format` parameter with 'raw' as default.
- Updated `fetchPageByTitle` handler in `src/tools/tool-handlers.ts` to pass `format` parameter.
- Updated `roam_fetch_page_by_title` case in `src/server/roam-server.ts` to extract and pass `format` parameter.

v.0.25.3

- FIXED: roam_create_block multiline content ordering issue
- Root cause: Simple newline-separated content was being created in reverse order
- Solution: Added logic to detect simple newline-separated content and reverse the nodes array to maintain original order
- Fix is specific to simple multiline content without markdown formatting, preserving existing behavior for complex markdown

v.0.25.2

- FIXED: roam_create_block heading formatting issue
- Root cause: Missing heading parameter extraction in server request handler
- Solution: Added heading parameter to roam_create_block handler in roam-server.ts
- Also removed problematic default: 0 from heading schema definition
- Heading formatting now works correctly for both single and multi-line blocks
- roam_create_block now properly applies H1, H2, and H3 formatting when heading parameter is provided

v.0.25.1

- Investigated heading formatting issue in roam_create_block tool
- Attempted multiple fixes: direct createBlock API → batchActions → convertToRoamActions → direct batch action creation
- Confirmed roam_create_page works correctly for heading formatting
- Identified that heading formatting fails specifically for single block creation via roam_create_block
- Issue remains unresolved despite extensive troubleshooting and multiple implementation approaches
- Current status: roam_create_block does not apply heading formatting, investigation ongoing

v.0.25.0

- Updated roam_create_page to use batchActions

v.0.24.6

- Updated roam_create_page to use explicit levels

v.0.24.5

- Enhanced createOutline to properly handle block_text_uid as either a 9-character UID or string title
- Added proper detection and use of existing blocks when given a valid block UID
- Improved error messages to be more specific about block operations

v.0.24.4

- Clarified roam_search_by_date and roam_fetch_page_by_title when it comes to searching for daily pages vs. blocks by date

v.0.24.3

- Clarified roam_update_multiple_blocks
- Added a variable to roam_find_pages_modified_today

v.0.24.2

- Added sort_by and filter_tag to roam_recall

v.0.24.1

- Fixed searchByStatus for TODO checks
- Added resolution of references to various tools

v.0.23.2

- Fixed create_page tool as first-level blocks were created in reversed order

v.0.23.1

- Fixed roam_outline tool not writing properly

v.0.23.0

- Added advanced, more flexible datomic query

v.0.22.1

- Important description change in roam_remember

v0.22.0

- Restructured search functionality into dedicated directory with proper TypeScript support
- Fixed TypeScript errors and import paths throughout the codebase
- Improved outline creation to maintain exact input array order
- Enhanced recall() method to fetch memories from both tag searches and dedicated memories page
- Maintained backward compatibility while improving code organization

v0.21.0

- Added roam_recall tool to recall memories from all tags and the page itself.

v0.20.0

- Added roam_remember tool to remember specific memories as created on the daily page. Can be used throughout the graph. Tag set in environmental vars in config.

v0.19.0

- Changed default case-sensitivity behavior in search tools to match Roam's native behavior (now defaults to true)
- Updated case-sensitivity handling in findBlockWithRetry, searchByStatus, searchForTag, and searchByDate tools

v0.18.0

- Added roam_search_by_date tool to search for blocks and pages based on creation or modification dates
- Added support for date range filtering and content inclusion options

v0.17.0

- Enhanced roam_update_block tool with transform pattern support, allowing regex-based content transformations
- Added ability to update blocks with either direct content or pattern-based transformations

v0.16.0

- Added roam_search_by_text tool to search for blocks containing specific text, with optional page scope and case sensitivity
- Fixed roam_search_by_tag

v.0.15.0

- Added roam_find_pages_modified_today tool to search for pages modified since midnight today

v.0.14
