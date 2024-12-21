# Roam Research MCP Server

[![npm version](https://badge.fury.io/js/roam-research-mcp.svg)](https://badge.fury.io/js/roam-research-mcp)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![GitHub](https://img.shields.io/github/license/2b3pro/roam-research-mcp)](https://github.com/2b3pro/roam-research-mcp/blob/main/LICENSE)

A Model Context Protocol (MCP) server that provides comprehensive access to Roam Research's API functionality. This server enables AI assistants like Claude to interact with your Roam Research graph through a standardized interface.

<a href="https://glama.ai/mcp/servers/fzfznyaflu"><img width="380" height="200" src="https://glama.ai/mcp/servers/fzfznyaflu/badge" alt="Roam Research MCP server" /></a>

## Installation

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

The server provides eleven powerful tools for interacting with Roam Research:

1. `search_blocks`: Search for blocks containing specific text
2. `create_page`: Create new pages with optional content
3. `create_block`: Create new blocks in existing pages
4. `pull_data`: Get data for specific blocks/pages
5. `pull_many_data`: Get data for multiple blocks/pages
6. `move_block`: Move blocks to new locations
7. `update_block`: Update block content and properties
8. `delete_block`: Delete blocks
9. `delete_page`: Delete pages
10. `batch_actions`: Perform multiple operations at once
11. `read_page_by_title`: Read a page's content by title with recursive block reference resolution

## Setup

1. Create a Roam Research API token:

   - Go to your graph settings
   - Navigate to the "API tokens" section
   - Create a new token

2. Configure the environment variables:
   You have two options for configuring the required environment variables:

   Option 1: Using a .env file (Recommended for development)
   Create a `.env` file in the roam-research directory:

   ```
   ROAM_API_TOKEN=your-api-token
   ROAM_GRAPH_NAME=your-graph-name
   ```

   Option 2: Using MCP settings (Alternative method)
   Add the configuration to your MCP settings file:

   - For Cline (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):

   ```json
   {
     "mcpServers": {
       "roam-research": {
         "command": "node",
         "args": ["/path/to/roam-research/build/index.js"],
         "env": {
           "ROAM_API_TOKEN": "your-api-token",
           "ROAM_GRAPH_NAME": "your-graph-name"
         }
       }
     }
   }
   ```

   - For Claude desktop app (`~/Library/Application Support/Claude/claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "roam-research": {
         "command": "node",
         "args": ["/path/to/roam-research/build/index.js"],
         "env": {
           "ROAM_API_TOKEN": "your-api-token",
           "ROAM_GRAPH_NAME": "your-graph-name"
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

### Search Blocks

Search for blocks containing specific text:

```typescript
use_mcp_tool roam-research search_blocks {
  "search_string": "example text"
}
```

### Read Page By Title

Read a page's content with resolved block references:

```typescript
use_mcp_tool roam-research read_page_by_title {
  "title": "Example Page"
}
```

Returns the page content as markdown with:

- All blocks in hierarchical structure
- Block references recursively resolved (up to 4 levels)
- Proper indentation for nesting levels

### Create Page

Create a new page with optional content:

```typescript
use_mcp_tool roam-research create_page {
  "title": "New Page",
  "content": "Initial content for the page"
}
```

### Create Block

Add a new block to an existing page:

```typescript
use_mcp_tool roam-research create_block {
  "page_uid": "target-page-uid",
  "content": "Block content"
}
```

### Pull Data

Get data for a specific block or page:

```typescript
use_mcp_tool roam-research pull_data {
  "pattern": "[*]",
  "uid": "block-or-page-uid"
}
```

### Pull Many Data

Get data for multiple blocks or pages:

```typescript
use_mcp_tool roam-research pull_many_data {
  "pattern": "[*]",
  "uids": "uid1,uid2,uid3"
}
```

### Move Block

Move a block to a new location:

```typescript
use_mcp_tool roam-research move_block {
  "block_uid": "block-to-move",
  "parent_uid": "new-parent",
  "order": "last"
}
```

### Update Block

Update block content and properties:

```typescript
use_mcp_tool roam-research update_block {
  "uid": "block-uid",
  "content": "New content",
  "open": true,
  "heading": 1
}
```

### Delete Block

Delete a block:

```typescript
use_mcp_tool roam-research delete_block {
  "uid": "block-to-delete"
}
```

### Delete Page

Delete a page:

```typescript
use_mcp_tool roam-research delete_page {
  "uid": "page-to-delete"
}
```

### Batch Actions

Perform multiple operations at once:

```typescript
use_mcp_tool roam-research batch_actions {
  "actions": [
    {
      "type": "create-page",
      "data": {
        "title": "New Page"
      }
    },
    {
      "type": "create-block",
      "data": {
        "location": {
          "parent-uid": "page-uid",
          "order": "last"
        },
        "block": {
          "string": "Block content"
        }
      }
    }
  ]
}
```

## Error Handling

The server provides comprehensive error handling:

- Invalid API token or insufficient privileges
- Rate limiting (too many requests)
- Graph not ready for requests
- Invalid parameters or missing data
- Failed operations

Each error response includes:

- Error code
- Descriptive message
- Stack trace (in development)

## Development

The server is built with TypeScript and includes:

- Full type definitions for the Roam Research API
- Comprehensive input schemas for all tools
- Proper handling of API responses
- Support for batch operations

To modify or extend the server:

1. Update types in `src/types.d.ts`
2. Modify server implementation in `src/index.ts`
3. Rebuild using `npm run build`

## License

ISC License
