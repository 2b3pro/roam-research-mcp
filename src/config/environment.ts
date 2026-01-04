import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Get the project root from the script path
const scriptPath = process.argv[1];  // Full path to the running script
const projectRoot = dirname(dirname(scriptPath));  // Go up two levels from build/index.js

// Try to load .env from project root
const envPath = join(projectRoot, '.env');
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// HTTP server configuration
const HTTP_STREAM_PORT = process.env.HTTP_STREAM_PORT || '8088';
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5678,https://roamresearch.com')
  .split(',')
  .map(origin => origin.trim());

// Re-export for backwards compatibility with single-graph mode
// These are still used by CLI commands and for validation
const API_TOKEN = process.env.ROAM_API_TOKEN as string;
const GRAPH_NAME = process.env.ROAM_GRAPH_NAME as string;

// Multi-graph mode configuration
const ROAM_GRAPHS = process.env.ROAM_GRAPHS;
const ROAM_DEFAULT_GRAPH = process.env.ROAM_DEFAULT_GRAPH;

/**
 * Check if we're in multi-graph mode
 */
export function isMultiGraphMode(): boolean {
  return !!ROAM_GRAPHS;
}

/**
 * Validate that either multi-graph or single-graph configuration is provided
 * Called during server/CLI initialization
 */
export function validateEnvironment(): void {
  if (ROAM_GRAPHS) {
    // Multi-graph mode
    if (!ROAM_DEFAULT_GRAPH) {
      throw new Error(
        'ROAM_DEFAULT_GRAPH is required when using ROAM_GRAPHS.\n' +
        'Set it to the key of the graph to use by default.'
      );
    }
    // Validate JSON
    try {
      JSON.parse(ROAM_GRAPHS);
    } catch (e) {
      throw new Error(`Invalid JSON in ROAM_GRAPHS: ${(e as Error).message}`);
    }
  } else {
    // Single-graph mode - require legacy env vars
    if (!API_TOKEN || !GRAPH_NAME) {
      const missingVars = [];
      if (!API_TOKEN) missingVars.push('ROAM_API_TOKEN');
      if (!GRAPH_NAME) missingVars.push('ROAM_GRAPH_NAME');

      throw new Error(
        `Missing required environment variables: ${missingVars.join(', ')}\n\n` +
        'Please configure these variables either:\n' +
        '1. In your MCP settings file:\n' +
        '   - For Cline: ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json\n' +
        '   - For Claude: ~/Library/Application Support/Claude/claude_desktop_config.json\n\n' +
        '   Example configuration:\n' +
        '   {\n' +
        '     "mcpServers": {\n' +
        '       "roam-research": {\n' +
        '         "command": "node",\n' +
        '         "args": ["/path/to/roam-research-mcp/build/index.js"],\n' +
        '         "env": {\n' +
        '           "ROAM_API_TOKEN": "your-api-token",\n' +
        '           "ROAM_GRAPH_NAME": "your-graph-name"\n' +
        '         }\n' +
        '       }\n' +
        '     }\n' +
        '   }\n\n' +
        '2. Or in a .env file in the roam-research directory:\n' +
        '   ROAM_API_TOKEN=your-api-token\n' +
        '   ROAM_GRAPH_NAME=your-graph-name\n\n' +
        '3. Or use multi-graph mode:\n' +
        '   ROAM_GRAPHS=\'{"personal": {"token": "...", "graph": "..."}}\'\n' +
        '   ROAM_DEFAULT_GRAPH=personal'
      );
    }
  }
}

export { API_TOKEN, GRAPH_NAME, HTTP_STREAM_PORT, CORS_ORIGINS, ROAM_GRAPHS, ROAM_DEFAULT_GRAPH };
