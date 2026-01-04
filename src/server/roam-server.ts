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
import { type Graph } from '@roam-research/roam-api-sdk';
import { HTTP_STREAM_PORT, validateEnvironment } from '../config/environment.js';
import { createRegistryFromEnv, GraphRegistry, isWriteOperation } from '../config/graph-registry.js';
import { toolSchemas } from '../tools/schemas.js';
import { ToolHandlers } from '../tools/tool-handlers.js';
import type { ContentItem } from '../tools/operations/pages.js';
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
  private registry: GraphRegistry;
  private toolHandlersCache: Map<string, ToolHandlers> = new Map();

  constructor() {
    // Validate environment first
    validateEnvironment();

    try {
      this.registry = createRegistryFromEnv();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Failed to initialize graph registry: ${errorMessage}`);
    }

    // Ensure toolSchemas is not empty before proceeding
    if (Object.keys(toolSchemas).length === 0) {
      throw new McpError(ErrorCode.InternalError, 'No tool schemas defined in src/tools/schemas.ts');
    }
  }

  /**
   * Get or create a ToolHandlers instance for a specific graph
   * Handlers are cached per-graph for efficiency
   */
  private getToolHandlers(graph: Graph, graphKey: string): ToolHandlers {
    const cached = this.toolHandlersCache.get(graphKey);
    if (cached) {
      return cached;
    }

    const handlers = new ToolHandlers(graph);
    this.toolHandlersCache.set(graphKey, handlers);
    return handlers;
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

  /**
   * Extract graph and write_key from tool arguments
   */
  private extractGraphParams(args: Record<string, unknown>): {
    graphKey: string | undefined;
    writeKey: string | undefined;
    cleanedArgs: Record<string, unknown>;
  } {
    const { graph, write_key, ...cleanedArgs } = args as {
      graph?: string;
      write_key?: string;
      [key: string]: unknown;
    };
    return {
      graphKey: graph,
      writeKey: write_key,
      cleanedArgs,
    };
  }

  /**
   * Resolve graph for a tool call with validation
   */
  private resolveGraph(toolName: string, graphKey: string | undefined, writeKey?: string): {
    graph: Graph;
    resolvedKey: string;
  } {
    const resolvedKey = graphKey ?? this.registry.defaultKey;
    const graph = this.registry.resolveGraphForTool(toolName, graphKey, writeKey);
    return { graph, resolvedKey };
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
        const args = (request.params.arguments ?? {}) as Record<string, unknown>;
        const { graphKey, writeKey, cleanedArgs } = this.extractGraphParams(args);
        const { graph, resolvedKey } = this.resolveGraph(request.params.name, graphKey, writeKey);
        const toolHandlers = this.getToolHandlers(graph, resolvedKey);

        switch (request.params.name) {
          case 'roam_markdown_cheatsheet': {
            const content = await toolHandlers.getRoamMarkdownCheatsheet();
            return {
              content: [{ type: 'text', text: content }],
            };
          }
          case 'roam_remember': {
            const { memory, categories, heading, parent_uid } = cleanedArgs as {
              memory: string;
              categories?: string[];
              heading?: string;
              parent_uid?: string;
            };
            const result = await toolHandlers.remember(memory, categories, heading, parent_uid);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_fetch_page_by_title': {
            const { title, format } = cleanedArgs as {
              title: string;
              format?: 'markdown' | 'raw';
            };
            const content = await toolHandlers.fetchPageByTitle(title, format);
            return {
              content: [{ type: 'text', text: content }],
            };
          }

          case 'roam_create_page': {
            const { title, content, skip_daily_page_link } = cleanedArgs as {
              title: string;
              content?: ContentItem[];
              skip_daily_page_link?: boolean;
            };
            const result = await toolHandlers.createPage(title, content, skip_daily_page_link);
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
            } = cleanedArgs as {
              content: string;
              page_uid?: string;
              page_title?: string;
              parent_uid?: string;
              parent_string?: string;
              order?: 'first' | 'last';
            };
            const result = await toolHandlers.importMarkdown(
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
            const { todos } = cleanedArgs as { todos: string[] };
            const result = await toolHandlers.addTodos(todos);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_create_outline': {
            const { outline, page_title_uid, block_text_uid } = cleanedArgs as {
              outline: Array<{ text: string | undefined; level: number }>;
              page_title_uid?: string;
              block_text_uid?: string;
            };
            const result = await toolHandlers.createOutline(
              outline,
              page_title_uid,
              block_text_uid
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_for_tag': {
            const { primary_tag, page_title_uid, near_tag } = cleanedArgs as {
              primary_tag: string;
              page_title_uid?: string;
              near_tag?: string;
            };
            const result = await toolHandlers.searchForTag(primary_tag, page_title_uid, near_tag);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_by_status': {
            const { status, page_title_uid, include, exclude } = cleanedArgs as {
              status: 'TODO' | 'DONE';
              page_title_uid?: string;
              include?: string;
              exclude?: string;
            };
            const result = await toolHandlers.searchByStatus(status, page_title_uid, include, exclude);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_block_refs': {
            const params = cleanedArgs as {
              block_uid?: string;
              title?: string;
              page_title_uid?: string;
            };
            const result = await toolHandlers.searchBlockRefs(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_hierarchy': {
            const params = cleanedArgs as {
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

            const result = await toolHandlers.searchHierarchy(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_find_pages_modified_today': {
            const { max_num_pages } = cleanedArgs as {
              max_num_pages?: number;
            };
            const result = await toolHandlers.findPagesModifiedToday(max_num_pages || 50);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_by_text': {
            const params = cleanedArgs as {
              text: string;
              page_title_uid?: string;
            };
            const result = await toolHandlers.searchByText(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_search_by_date': {
            const params = cleanedArgs as {
              start_date: string;
              end_date?: string;
              type: 'created' | 'modified' | 'both';
              scope: 'blocks' | 'pages' | 'both';
              include_content: boolean;
            };
            const result = await toolHandlers.searchByDate(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }


          case 'roam_recall': {
            const { sort_by = 'newest', filter_tag } = cleanedArgs as {
              sort_by?: 'newest' | 'oldest';
              filter_tag?: string;
            };
            const result = await toolHandlers.recall(sort_by, filter_tag);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }


          case 'roam_datomic_query': {
            const { query, inputs } = cleanedArgs as {
              query: string;
              inputs?: unknown[];
            };
            const result = await toolHandlers.executeDatomicQuery({ query, inputs });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_process_batch_actions': {
            const { actions } = cleanedArgs as {
              actions: any[];
            };
            const result = await toolHandlers.processBatch(actions);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_fetch_block_with_children': {
            const { block_uid, depth } = cleanedArgs as {
              block_uid: string;
              depth?: number;
            };
            const result = await toolHandlers.fetchBlockWithChildren(block_uid, depth);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_create_table': {
            const { parent_uid, order, headers, rows } = cleanedArgs as {
              parent_uid: string;
              order?: number | 'first' | 'last';
              headers: string[];
              rows: Array<{ label: string; cells: string[] }>;
            };
            const result = await toolHandlers.createTable({
              parent_uid,
              order,
              headers,
              rows
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_move_block': {
            const { block_uid, parent_uid, order = 'last' } = cleanedArgs as {
              block_uid: string;
              parent_uid: string;
              order?: number | 'first' | 'last';
            };
            const result = await toolHandlers.moveBlock(block_uid, parent_uid, order);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'roam_update_page_markdown': {
            const { title, markdown, dry_run = false } = cleanedArgs as {
              title: string;
              markdown: string;
              dry_run?: boolean;
            };
            const result = await toolHandlers.updatePageMarkdown(title, markdown, dry_run);
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


      // Track active transports by session ID for proper session management
      const activeSessions = new Map<string, StreamableHTTPServerTransport>();

      const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // Set CORS headers dynamically based on request origin
        const requestOrigin = req.headers.origin;
        if (requestOrigin && CORS_ORIGINS.includes(requestOrigin)) {
          res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        } else if (CORS_ORIGINS.includes('*')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        // Handle preflight OPTIONS requests
        if (req.method === 'OPTIONS') {
          res.writeHead(204); // No Content
          res.end();
          return;
        }

        // Check for existing session ID in header
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        // Handle session termination (DELETE request)
        if (req.method === 'DELETE' && sessionId) {
          const transport = activeSessions.get(sessionId);
          if (transport) {
            await transport.close();
            activeSessions.delete(sessionId);
            res.writeHead(200);
            res.end();
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
          }
          return;
        }

        try {
          // If we have an existing session, use that transport
          if (sessionId && activeSessions.has(sessionId)) {
            const transport = activeSessions.get(sessionId)!;
            await transport.handleRequest(req, res);
            return;
          }

          // Create new transport and server for new sessions
          const httpMcpServer = this.createMcpServer('-http');
          const httpStreamTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
            onsessioninitialized: (newSessionId) => {
              activeSessions.set(newSessionId, httpStreamTransport);
            }
          });

          // Clean up session when transport closes
          httpStreamTransport.onclose = () => {
            const entries = activeSessions.entries();
            for (const [key, value] of entries) {
              if (value === httpStreamTransport) {
                activeSessions.delete(key);
                break;
              }
            }
          };

          await httpMcpServer.connect(httpStreamTransport);
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
