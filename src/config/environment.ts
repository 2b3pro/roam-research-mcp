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

// Required environment variables
const API_TOKEN = process.env.ROAM_API_TOKEN as string;
const GRAPH_NAME = process.env.ROAM_GRAPH_NAME as string;

// Validate environment variables
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
    '   ROAM_GRAPH_NAME=your-graph-name'
  );
}

const HTTP_STREAM_PORT = process.env.HTTP_STREAM_PORT || '8088'; // Default to 8088
const SSE_PORT = process.env.SSE_PORT || '8087'; // Default to 8087
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5678';

export { API_TOKEN, GRAPH_NAME, HTTP_STREAM_PORT, SSE_PORT, CORS_ORIGIN };
