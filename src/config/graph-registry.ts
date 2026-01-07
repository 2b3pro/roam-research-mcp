/**
 * GraphRegistry - Manages multiple Roam graph connections with safety guardrails
 *
 * Supports:
 * - Multiple graph configurations via ROAM_GRAPHS env var
 * - Backwards compatibility with single graph via ROAM_API_TOKEN/ROAM_GRAPH_NAME
 * - Write protection via protected: true flag + ROAM_SYSTEM_WRITE_KEY env var
 * - Lazy graph initialization (connects only when first accessed)
 */

import { initializeGraph, type Graph } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Configuration for a single Roam graph
 */
export interface GraphConfig {
  token: string;
  graph: string;
  /** If true, writes require ROAM_SYSTEM_WRITE_KEY confirmation */
  protected?: boolean;
}

/**
 * Multi-graph configuration parsed from ROAM_GRAPHS env var
 */
export interface MultiGraphConfig {
  [key: string]: GraphConfig;
}

/** List of tool names that perform write operations */
export const WRITE_OPERATIONS = [
  'roam_create_page',
  'roam_create_outline',
  'roam_import_markdown',
  'roam_process_batch_actions',
  'roam_add_todo',
  'roam_remember',
  'roam_create_table',
  'roam_move_block',
  'roam_update_page_markdown',
  'roam_rename_page',
] as const;

export type WriteOperation = typeof WRITE_OPERATIONS[number];

/**
 * Check if a tool name is a write operation
 */
export function isWriteOperation(toolName: string): toolName is WriteOperation {
  return WRITE_OPERATIONS.includes(toolName as WriteOperation);
}

/**
 * GraphRegistry - Central manager for multiple Roam graph connections
 */
export class GraphRegistry {
  private configs: Map<string, GraphConfig>;
  private initialized: Map<string, Graph>;
  readonly defaultKey: string;
  readonly isMultiGraph: boolean;

  constructor(
    configs: MultiGraphConfig,
    defaultKey: string
  ) {
    this.configs = new Map(Object.entries(configs));
    this.initialized = new Map();
    this.defaultKey = defaultKey;
    this.isMultiGraph = this.configs.size > 1;

    // Validate default key exists
    if (!this.configs.has(defaultKey)) {
      throw new Error(`Default graph key "${defaultKey}" not found in configuration`);
    }
  }

  /**
   * Get configuration for a graph by key
   */
  getConfig(key: string): GraphConfig | undefined {
    return this.configs.get(key);
  }

  /**
   * Get all available graph keys
   */
  getAvailableGraphs(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Get an initialized Graph instance, creating it lazily if needed
   * @param key - Graph key from config. Defaults to defaultKey if not specified.
   */
  getGraph(key?: string): Graph {
    const resolvedKey = key ?? this.defaultKey;

    // Check if already initialized
    const existing = this.initialized.get(resolvedKey);
    if (existing) {
      return existing;
    }

    // Get config
    const config = this.configs.get(resolvedKey);
    if (!config) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown graph: "${resolvedKey}". Available graphs: ${this.getAvailableGraphs().join(', ')}`
      );
    }

    // Initialize the graph
    const graph = initializeGraph({
      token: config.token,
      graph: config.graph,
    });

    this.initialized.set(resolvedKey, graph);
    return graph;
  }

  /**
   * Check if a write operation is allowed for a given graph
   *
   * Rules:
   * - Writes to default graph are always allowed
   * - Writes to non-default graphs require:
   *   - If protected: true, must provide matching ROAM_SYSTEM_WRITE_KEY
   *   - If not protected: writes are allowed
   */
  isWriteAllowed(graphKey: string | undefined, providedWriteKey?: string): boolean {
    const resolvedKey = graphKey ?? this.defaultKey;

    // Writes to default graph are always allowed
    if (resolvedKey === this.defaultKey) {
      return true;
    }

    const config = this.configs.get(resolvedKey);
    if (!config) {
      return false; // Unknown graph
    }

    // If graph is not protected, allow writes
    if (!config.protected) {
      return true;
    }

    // Check if provided key matches ROAM_SYSTEM_WRITE_KEY
    const systemWriteKey = process.env.ROAM_SYSTEM_WRITE_KEY;
    return !!systemWriteKey && providedWriteKey === systemWriteKey;
  }

  /**
   * Validate write access and return an informative error if denied
   */
  validateWriteAccess(
    toolName: string,
    graphKey: string | undefined,
    providedWriteKey?: string
  ): void {
    if (!isWriteOperation(toolName)) {
      return; // Not a write operation, no validation needed
    }

    const resolvedKey = graphKey ?? this.defaultKey;

    if (!this.isWriteAllowed(resolvedKey, providedWriteKey)) {
      const config = this.configs.get(resolvedKey);
      if (!config) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown graph: "${resolvedKey}". Available graphs: ${this.getAvailableGraphs().join(', ')}`
        );
      }

      const systemWriteKey = process.env.ROAM_SYSTEM_WRITE_KEY;
      if (!systemWriteKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Write to protected graph "${resolvedKey}" failed: ROAM_SYSTEM_WRITE_KEY not configured.`
        );
      }

      // Provide informative error with the required key
      throw new McpError(
        ErrorCode.InvalidParams,
        `Write to "${resolvedKey}" graph requires write_key confirmation.\n` +
        `Provide write_key: "${systemWriteKey}" to proceed.`
      );
    }
  }

  /**
   * Resolve graph key and validate access for a tool call
   * Returns the Graph instance ready to use
   */
  resolveGraphForTool(
    toolName: string,
    graphKey: string | undefined,
    writeKey?: string
  ): Graph {
    // Validate write access if this is a write operation
    this.validateWriteAccess(toolName, graphKey, writeKey);

    // Return the graph instance
    return this.getGraph(graphKey);
  }

  /**
   * Generate markdown documentation about available graphs and their configuration
   * Used to inform AI models about graph access requirements
   */
  getGraphInfoMarkdown(): string {
    const graphKeys = this.getAvailableGraphs();

    // Single graph mode - minimal info
    if (graphKeys.length === 1 && graphKeys[0] === 'default') {
      return ''; // No need to show graph info in single-graph mode
    }

    const lines: string[] = [
      '## Available Graphs',
      '',
      '| Graph | Default | Write Protected |',
      '|-------|---------|-----------------|',
    ];

    for (const key of graphKeys) {
      const config = this.configs.get(key)!;
      const isDefault = key === this.defaultKey;
      const isProtected = !!config.protected;

      const defaultCol = isDefault ? '✓' : '';
      const protectedCol = isProtected ? 'Yes' : 'No';

      lines.push(`| ${key} | ${defaultCol} | ${protectedCol} |`);
    }

    lines.push('');
    lines.push('> **Note:** Write operations to protected graphs require the `write_key` parameter. The key will be shown in the error message if omitted.');
    lines.push('');
    lines.push('---');
    lines.push('');

    return lines.join('\n');
  }
}

/**
 * Create a GraphRegistry from environment variables
 *
 * Supports two modes:
 * 1. Multi-graph: ROAM_GRAPHS JSON + ROAM_DEFAULT_GRAPH
 * 2. Single graph (backwards compat): ROAM_API_TOKEN + ROAM_GRAPH_NAME
 */
export function createRegistryFromEnv(): GraphRegistry {
  const roamGraphsJson = process.env.ROAM_GRAPHS;

  if (roamGraphsJson) {
    // Multi-graph mode
    try {
      const configs = JSON.parse(roamGraphsJson) as MultiGraphConfig;
      const defaultKey = process.env.ROAM_DEFAULT_GRAPH?.trim().replace(/,+$/, '');

      if (!defaultKey) {
        throw new Error('ROAM_DEFAULT_GRAPH is required when using ROAM_GRAPHS');
      }

      return new GraphRegistry(configs, defaultKey);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in ROAM_GRAPHS: ${error.message}`);
      }
      throw error;
    }
  }

  // Backwards compatibility: single graph mode
  const token = process.env.ROAM_API_TOKEN;
  const graphName = process.env.ROAM_GRAPH_NAME;

  if (!token || !graphName) {
    const missingVars = [];
    if (!token) missingVars.push('ROAM_API_TOKEN');
    if (!graphName) missingVars.push('ROAM_GRAPH_NAME');

    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}\n\n` +
      'Configure either:\n' +
      '1. Multi-graph mode:\n' +
      '   ROAM_GRAPHS=\'{"personal": {"token": "...", "graph": "..."}}\'\n' +
      '   ROAM_DEFAULT_GRAPH=personal\n\n' +
      '2. Single graph mode (backwards compatible):\n' +
      '   ROAM_API_TOKEN=your-api-token\n' +
      '   ROAM_GRAPH_NAME=your-graph-name'
    );
  }

  // Create single-graph registry with "default" as the key
  const configs: MultiGraphConfig = {
    default: {
      token,
      graph: graphName,
    }
  };

  return new GraphRegistry(configs, 'default');
}
