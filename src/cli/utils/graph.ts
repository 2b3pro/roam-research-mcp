/**
 * CLI graph resolution utilities for multi-graph support
 */

import { type Graph } from '@roam-research/roam-api-sdk';
import { createRegistryFromEnv, GraphRegistry, isWriteOperation } from '../../config/graph-registry.js';
import { validateEnvironment } from '../../config/environment.js';

let registry: GraphRegistry | null = null;

/**
 * Get or create the GraphRegistry singleton
 */
export function getRegistry(): GraphRegistry {
  if (!registry) {
    validateEnvironment();
    registry = createRegistryFromEnv();
  }
  return registry;
}

/**
 * Options for graph resolution in CLI commands
 */
export interface GraphOptions {
  graph?: string;
  writeKey?: string;
}

/**
 * Resolve a Graph instance for CLI use
 * Validates write access for write operations
 *
 * @param options - CLI options containing graph and writeKey
 * @param isWriteOp - Whether this is a write operation
 */
export function resolveGraph(options: GraphOptions, isWriteOp: boolean = false): Graph {
  const reg = getRegistry();

  if (isWriteOp) {
    // For write operations, validate write access
    const graphKey = options.graph ?? reg.defaultKey;

    if (!reg.isWriteAllowed(graphKey, options.writeKey)) {
      const config = reg.getConfig(graphKey);
      if (config?.protected) {
        const systemWriteKey = process.env.ROAM_SYSTEM_WRITE_KEY;
        if (!systemWriteKey) {
          throw new Error(
            `Write to protected graph "${graphKey}" failed: ROAM_SYSTEM_WRITE_KEY not configured.`
          );
        }
        throw new Error(
          `Write to "${graphKey}" graph requires --write-key confirmation.\n` +
          `Use: --write-key "${systemWriteKey}"`
        );
      }
    }
  }

  return reg.getGraph(options.graph);
}

/**
 * Get available graph names for help text
 */
export function getAvailableGraphs(): string[] {
  return getRegistry().getAvailableGraphs();
}

/**
 * Get the default graph key
 */
export function getDefaultGraphKey(): string {
  return getRegistry().defaultKey;
}

/**
 * Check if running in multi-graph mode
 */
export function isMultiGraphMode(): boolean {
  return getRegistry().isMultiGraph;
}
