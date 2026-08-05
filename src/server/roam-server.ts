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
import { HTTP_STREAM_PORT, HTTP_STREAM_HOST, HTTP_AUTH_TOKEN, validateEnvironment } from '../config/environment.js';
import { isBearerAuthorized } from '../utils/auth.js';
import { RoamError, toErrorResult } from '../shared/errors.js';
import { createRegistryFromEnv, GraphRegistry, isWriteOperation } from '../config/graph-registry.js';
import { toolSchemas } from '../tools/schemas.js';
import { ToolHandlers } from '../tools/tool-handlers.js';
import type { ContentItem } from '../tools/operations/pages.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { isPortInUse } from '../utils/net.js';
import { CORS_ORIGINS } from '../config/environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json to get the version
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const serverVersion = packageJson.version;

/**
 * The single place a tool result is built, and the only place
 * `structuredContent` may be attached.
 *
 * The wire invariant is **`structuredContent` is present iff the tool declares
 * an `outputSchema`**. A schema-bearing tool that returns none, or a
 * schema-less tool that returns some, is a protocol violation a strict client
 * will reject. We use the low-level `Server` rather than `McpServer`, so the
 * SDK does not enforce this for us — routing every result through here is what
 * enforces it. Adding a schema in schemas.ts is therefore sufficient; no switch
 * case needs touching.
 *
 * The text channel is unchanged either way, so clients that never look at
 * structuredContent see exactly what they saw before.
 */
function toolResult(toolName: string, result: unknown) {
  const declaresSchema = Boolean(
    (toolSchemas as Record<string, { outputSchema?: unknown } | undefined>)[toolName]?.outputSchema
  );
  const canStructure = declaresSchema && result !== null && typeof result === 'object';

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    ...(canStructure ? { structuredContent: result as Record<string, unknown> } : {}),
  };
}

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

    const memoriesTag = this.registry.getMemoriesTag(graphKey);
    const guidelinesPage = this.registry.getGuidelinesPage(graphKey);
    const handlers = new ToolHandlers(graph, memoriesTag, guidelinesPage);
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
            const graphInfo = this.registry.getGraphInfoMarkdown();
            const cheatsheet = await toolHandlers.getRoamMarkdownCheatsheet();
            const content = graphInfo + cheatsheet;
            return {
              content: [{ type: 'text', text: content }],
            };
          }
          case 'roam_remember': {
            const { memory, categories, heading, parent_uid, include_memories_tag } = cleanedArgs as {
              memory: string;
              categories?: string[];
              heading?: string;
              parent_uid?: string;
              include_memories_tag?: boolean;
            };
            const result = await toolHandlers.remember(
              memory,
              categories,
              heading,
              parent_uid,
              include_memories_tag
            );
            return toolResult(request.params.name, result);
          }

          case 'roam_fetch_page_full_view': {
            const { title, children_depth, max_references } = cleanedArgs as {
              title: string;
              children_depth?: number;
              max_references?: number;
            };
            const content = await toolHandlers.fetchPageFullView(title, children_depth, max_references);
            return {
              content: [{ type: 'text', text: content }],
            };
          }

          case 'roam_get_subpages': {
            const { prefix, filter_tag, include_content } = cleanedArgs as {
              prefix: string;
              filter_tag?: string;
              include_content?: boolean;
            };
            const content = await toolHandlers.getSubPages(prefix, filter_tag, include_content);
            return {
              content: [{ type: 'text', text: content }],
            };
          }

          case 'roam_get_guidelines': {
            const result = await toolHandlers.getGuidelines();
            return toolResult(request.params.name, result);
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
            const { title, content } = cleanedArgs as {
              title: string;
              content?: ContentItem[];
            };
            const result = await toolHandlers.createPage(title, content);
            return toolResult(request.params.name, result);
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
            return toolResult(request.params.name, result);
          }

          case 'roam_add_todo': {
            const { todos } = cleanedArgs as { todos: string[] };
            const result = await toolHandlers.addTodos(todos);
            return toolResult(request.params.name, result);
          }

          case 'roam_create_outline': {
            const { outline, page_title_uid, block_text_uid, order } = cleanedArgs as {
              outline: Array<{ text: string | undefined; level: number }>;
              page_title_uid?: string;
              block_text_uid?: string;
              order?: 'first' | 'last' | number;
            };
            const result = await toolHandlers.createOutline(
              outline,
              page_title_uid,
              block_text_uid,
              order
            );
            return toolResult(request.params.name, result);
          }

          case 'roam_search_for_tag': {
            const { primary_tag, page_title_uid, near_tag } = cleanedArgs as {
              primary_tag: string;
              page_title_uid?: string;
              near_tag?: string;
            };
            if (!primary_tag) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Missing required parameter: primary_tag (the tag to search for). Use page_title_uid to limit search to a specific page.'
              );
            }
            const result = await toolHandlers.searchForTag(primary_tag, page_title_uid, near_tag);
            return toolResult(request.params.name, result);
          }

          case 'roam_search_by_status': {
            const { status, page_title_uid, include, exclude } = cleanedArgs as {
              status: 'TODO' | 'DONE';
              page_title_uid?: string;
              include?: string;
              exclude?: string;
            };
            const result = await toolHandlers.searchByStatus(status, page_title_uid, include, exclude);
            return toolResult(request.params.name, result);
          }

          case 'roam_search_block_refs': {
            const params = cleanedArgs as {
              block_uid?: string;
              title?: string;
              page_title_uid?: string;
            };
            const result = await toolHandlers.searchBlockRefs(params);
            return toolResult(request.params.name, result);
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
            return toolResult(request.params.name, result);
          }

          case 'roam_find_pages_modified_today': {
            const { max_num_pages } = cleanedArgs as {
              max_num_pages?: number;
            };
            const result = await toolHandlers.findPagesModifiedToday(max_num_pages || 50);
            return toolResult(request.params.name, result);
          }

          case 'roam_search_by_text': {
            const params = cleanedArgs as {
              text: string;
              page_title_uid?: string;
              scope?: 'blocks' | 'page_titles';
            };
            const result = await toolHandlers.searchByText(params);
            return toolResult(request.params.name, result);
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
            return toolResult(request.params.name, result);
          }


          case 'roam_recall': {
            const { sort_by = 'newest', filter_tag } = cleanedArgs as {
              sort_by?: 'newest' | 'oldest';
              filter_tag?: string;
            };
            const result = await toolHandlers.recall(sort_by, filter_tag);
            return toolResult(request.params.name, result);
          }


          case 'roam_datomic_query': {
            const { query, inputs } = cleanedArgs as {
              query: string;
              inputs?: unknown[];
            };
            const result = await toolHandlers.executeDatomicQuery({ query, inputs });
            return toolResult(request.params.name, result);
          }

          case 'roam_process_batch_actions': {
            const { actions } = cleanedArgs as {
              actions: any[];
            };
            const result = await toolHandlers.processBatch(actions);
            return toolResult(request.params.name, result);
          }

          case 'roam_fetch_block': {
            const { block_uid, depth, include_ancestors } = cleanedArgs as {
              block_uid: string;
              depth?: number;
              include_ancestors?: boolean;
            };
            const result = await toolHandlers.fetchBlock(block_uid, depth, include_ancestors);
            return toolResult(request.params.name, result);
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
            return toolResult(request.params.name, result);
          }

          case 'roam_move_block': {
            const { block_uid, parent_uid, order = 'last' } = cleanedArgs as {
              block_uid: string;
              parent_uid: string;
              order?: number | 'first' | 'last';
            };
            const result = await toolHandlers.moveBlock(block_uid, parent_uid, order);
            return toolResult(request.params.name, result);
          }

          case 'roam_update_page_markdown': {
            const { title, markdown, dry_run = false } = cleanedArgs as {
              title: string;
              markdown: string;
              dry_run?: boolean;
            };
            const result = await toolHandlers.updatePageMarkdown(title, markdown, dry_run);
            return toolResult(request.params.name, result);
          }

          case 'roam_rename_page': {
            const { old_title, uid, new_title } = cleanedArgs as {
              old_title?: string;
              uid?: string;
              new_title: string;
            };
            const result = await toolHandlers.renamePage({ old_title, uid, new_title });
            return toolResult(request.params.name, result);
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: unknown) {
        // A RoamError is a TOOL failure, not a protocol failure: return it as
        // content with isError so the model can read the code and the recovery
        // context (available_graphs, and so on) and act on it. Throwing would
        // collapse all of that into a JSON-RPC error string.
        if (error instanceof RoamError) {
          return toErrorResult(error);
        }
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

  async run(options: { serverMode?: boolean } = {}) {
    const { serverMode = false } = options;

    try {

      // The two transports are mutually exclusive, and each mode opens exactly
      // one. Stdio mode talks to the client that spawned it over stdin/stdout
      // and returns here — it opens no socket at all. Nothing about MCP over
      // stdio needs one, and a listener nobody asked for is pure attack
      // surface: until 3.1.0 stdio mode also bound an HTTP port, which shipped
      // a token-free MCP endpoint per spawned instance. Run `--server` when
      // you want HTTP; that is what it is for.
      if (!serverMode) {
        const stdioMcpServer = this.createMcpServer();
        const stdioTransport = new StdioServerTransport();
        await stdioMcpServer.connect(stdioTransport);
        return;
      }


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

        // Liveness probe — cheap, no MCP handshake required. Useful for the
        // LaunchAgent/health checks (a bare GET on the MCP endpoint returns 406).
        const requestPath = (req.url || '/').split('?')[0];
        if (req.method === 'GET' && requestPath === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            name: 'roam-research-mcp',
            version: serverVersion,
            // Always 'server' since 3.1.0: this handler is only reachable in
            // --server mode. Kept as a field because clients read it, and the
            // retired 'stdio+http' value is how they can tell they are talking
            // to an older build that still had the stdio-mode listener.
            mode: 'server',
            auth: HTTP_AUTH_TOKEN ? 'required' : 'none',
            graphs: this.registry.getAvailableGraphs(),
            defaultGraph: this.registry.defaultKey,
            activeSessions: activeSessions.size,
          }));
          return;
        }

        // Transport authentication (perimeter): when HTTP_AUTH_TOKEN is set,
        // every MCP request must carry `Authorization: Bearer <token>`. /health
        // and OPTIONS are intentionally exempt (handled above). Unset = open.
        if (HTTP_AUTH_TOKEN && !isBearerAuthorized(req.headers['authorization'], HTTP_AUTH_TOKEN)) {
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer',
          });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Unauthorized: missing or invalid bearer token' },
            id: null,
          }));
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

          // A request that carries a session ID we don't know (the daemon
          // restarted, or the session was terminated) is a dead session. Per
          // the MCP streamable-HTTP spec the server MUST respond 404 so the
          // client starts a new session with a fresh InitializeRequest.
          // Falling through to a new transport instead makes the SDK answer
          // HTTP 400 "Server not initialized", which clients do not treat as
          // a re-initialize signal — they keep retrying the dead session and
          // every tool call times out with no useful error.
          if (sessionId) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32001, message: 'Session not found' },
              id: null,
            }));
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

      const desiredPort = parseInt(HTTP_STREAM_PORT);

      // A shared daemon must own a stable URL — never silently drift to another
      // port. Fail loudly if the configured port is already taken on our bind
      // host (a listener on a different interface is not our conflict).
      if (await isPortInUse(desiredPort, HTTP_STREAM_HOST)) {
        throw new McpError(
          ErrorCode.InternalError,
          `--server: port ${desiredPort} (HTTP_STREAM_PORT) is already in use. ` +
          `Stop the process using it, or set HTTP_STREAM_PORT to a free port.`
        );
      }
      httpServer.listen(desiredPort, HTTP_STREAM_HOST, () => {
        console.error(
          `roam-research-mcp v${serverVersion} (--server) listening on ` +
          `http://${HTTP_STREAM_HOST}:${desiredPort}/  (health: /health)`
        );
      });



    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Failed to connect MCP server: ${errorMessage}`);
    }
  }
}
