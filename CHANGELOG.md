# Changelog

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
