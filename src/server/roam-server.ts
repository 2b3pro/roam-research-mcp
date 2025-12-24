import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  Resource,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initializeGraph, type Graph } from '@roam-research/roam-api-sdk';
import { API_TOKEN, GRAPH_NAME, HTTP_STREAM_PORT } from '../config/environment.js';
import { toolSchemas } from '../tools/schemas.js';
import { ToolHandlers } from '../tools/tool-handlers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { findAvailablePort } from '../utils/net.js';
import { CORS_ORIGINS } from '../config/environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json to get the version
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const serverVersion = packageJson.version;

export class RoamServer {
  private toolHandlers: ToolHandlers;
  private graph: Graph;

  constructor() {

    try {
      this.graph = initializeGraph({
        token: API_TOKEN,
        graph: GRAPH_NAME,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Failed to initialize Roam graph: ${errorMessage}`);
    }

    try {
      this.toolHandlers = new ToolHandlers(this.graph);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Failed to initialize tool handlers: ${errorMessage}`);
    }

    // Ensure toolSchemas is not empty before proceeding
    if (Object.keys(toolSchemas).length === 0) {
      throw new McpError(ErrorCode.InternalError, 'No tool schemas defined in src/tools/schemas.ts');
    }

  }

  // Helper to create and configure MCP server instance
  private createMcpServer(nameSuffix: string = '') {
    const server = new Server(
      {
        name: `roam-research${nameSuffix}`,
        version: serverVersion,
      },
      {
        capabilities: {
          tools: {
            ...Object.fromEntries(
              (Object.keys(toolSchemas) as Array<keyof typeof toolSchemas>).map((toolName) => [toolName, toolSchemas[toolName].inputSchema])
            ),
          },
          resources: {}, // No resources exposed via capabilities
          prompts: {}, // No prompts exposed via capabilities
        },
      }
    );
    this.setupRequestHandlers(server);
    return server;
  }

  // Refactored to accept a Server instance
  private setupRequestHandlers(mcpServer: Server) {
    // List available tools
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.values(toolSchemas),
    }));

    // List available resources
    mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources: Resource[] = []; // No resources, as cheatsheet is now a tool
      return { resources };
    });

    // Access resource - no resources handled directly here anymore
    mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      throw new McpError(ErrorCode.InternalError, `Resource not found: ${request.params.uri}`);
    });

    // List available prompts
    mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      return { prompts: [] };
    });

    // Handle tool calls
    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'roam_markdown_cheatsheet': {
            const content = await this.toolHandlers.getRoamMarkdownCheatsheet();
            return {
              content: [{ type: 'text', text: content }],
            };
          }
          case 'roam_remember': {
            const { memory, categories } = request.params.arguments as {
              memory: string;
              categories?: string[];
            };
            const result = await this.toolHandlers.remember(memory, categories);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_fetch_page_by_title': {
            const { title, format } = request.params.arguments as {
              title: string;
              format?: 'markdown' | 'raw';
            };
            const content = await this.toolHandlers.fetchPageByTitle(title, format);
            return {
              content: [{ type: 'text', text: content }],
            };
          }

          case 'roam_create_page': {
            const { title, content } = request.params.arguments as {
              title: string;
              content?: Array<{
                text: string;
                level: number;
              }>;
            };
            const result = await this.toolHandlers.createPage(title, content);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }


          case 'roam_import_markdown': {
            const {
              content,
              page_uid,
              page_title,
              parent_uid,
              parent_string,
              order = 'first'
            } = request.params.arguments as {
              content: string;
              page_uid?: string;
              page_title?: string;
              parent_uid?: string;
              parent_string?: string;
              order?: 'first' | 'last';
            };
            const result = await this.toolHandlers.importMarkdown(
              content,
              page_uid,
              page_title,
              parent_uid,
              parent_string,
              order
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_add_todo': {
            const { todos } = request.params.arguments as { todos: string[] };
            const result = await this.toolHandlers.addTodos(todos);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_create_outline': {
            const { outline, page_title_uid, block_text_uid } = request.params.arguments as {
              outline: Array<{ text: string | undefined; level: number }>;
              page_title_uid?: string;
              block_text_uid?: string;
            };
            const result = await this.toolHandlers.createOutline(
              outline,
              page_title_uid,
              block_text_uid
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_for_tag': {
            const { primary_tag, page_title_uid, near_tag } = request.params.arguments as {
              primary_tag: string;
              page_title_uid?: string;
              near_tag?: string;
            };
            const result = await this.toolHandlers.searchForTag(primary_tag, page_title_uid, near_tag);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_by_status': {
            const { status, page_title_uid, include, exclude } = request.params.arguments as {
              status: 'TODO' | 'DONE';
              page_title_uid?: string;
              include?: string;
              exclude?: string;
            };
            const result = await this.toolHandlers.searchByStatus(status, page_title_uid, include, exclude);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_block_refs': {
            const params = request.params.arguments as {
              block_uid?: string;
              page_title_uid?: string;
            };
            const result = await this.toolHandlers.searchBlockRefs(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_hierarchy': {
            const params = request.params.arguments as {
              parent_uid?: string;
              child_uid?: string;
              page_title_uid?: string;
              max_depth?: number;
            };

            // Validate that either parent_uid or child_uid is provided, but not both
            if ((!params.parent_uid && !params.child_uid) || (params.parent_uid && params.child_uid)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                'Either parent_uid or child_uid must be provided, but not both'
              );
            }

            const result = await this.toolHandlers.searchHierarchy(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_find_pages_modified_today': {
            const { max_num_pages } = request.params.arguments as {
              max_num_pages?: number;
            };
            const result = await this.toolHandlers.findPagesModifiedToday(max_num_pages || 50);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_by_text': {
            const params = request.params.arguments as {
              text: string;
              page_title_uid?: string;
            };
            const result = await this.toolHandlers.searchByText(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_by_date': {
            const params = request.params.arguments as {
              start_date: string;
              end_date?: string;
              type: 'created' | 'modified' | 'both';
              scope: 'blocks' | 'pages' | 'both';
              include_content: boolean;
            };
            const result = await this.toolHandlers.searchByDate(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }


          case 'roam_recall': {
            const { sort_by = 'newest', filter_tag } = request.params.arguments as {
              sort_by?: 'newest' | 'oldest';
              filter_tag?: string;
            };
            const result = await this.toolHandlers.recall(sort_by, filter_tag);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }


          case 'roam_datomic_query': {
            const { query, inputs } = request.params.arguments as {
              query: string;
              inputs?: unknown[];
            };
            const result = await this.toolHandlers.executeDatomicQuery({ query, inputs });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_process_batch_actions': {
            const { actions } = request.params.arguments as {
              actions: any[];
            };
            const result = await this.toolHandlers.processBatch(actions);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_fetch_block_with_children': {
            const { block_uid, depth } = request.params.arguments as {
              block_uid: string;
              depth?: number;
            };
            const result = await this.toolHandlers.fetchBlockWithChildren(block_uid, depth);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: unknown) {
        if (error instanceof McpError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Roam API error: ${errorMessage}`
        );
      }
    });
  }

  async run() {

    try {

      const stdioMcpServer = this.createMcpServer();
      const stdioTransport = new StdioServerTransport();
      await stdioMcpServer.connect(stdioTransport);


      const httpMcpServer = this.createMcpServer('-http');
      const httpStreamTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
      });
      await httpMcpServer.connect(httpStreamTransport);


      const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // Set CORS headers dynamically based on request origin
        const requestOrigin = req.headers.origin;
        if (requestOrigin && CORS_ORIGINS.includes(requestOrigin)) {
          res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        } else if (CORS_ORIGINS.includes('*')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        // Handle preflight OPTIONS requests
        if (req.method === 'OPTIONS') {
          res.writeHead(204); // No Content
          res.end();
          return;
        }

        try {
          await httpStreamTransport.handleRequest(req, res);
        } catch (error) {

          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
          }
        }
      });

      const availableHttpPort = await findAvailablePort(parseInt(HTTP_STREAM_PORT));
      httpServer.listen(availableHttpPort, () => {

      });



    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Failed to connect MCP server: ${errorMessage}`);
    }
  }
}
