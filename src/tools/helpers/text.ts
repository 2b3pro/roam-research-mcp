/**
 * Capitalizes each word in a string
 */
import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';

/**
 * Capitalizes each word in a string
 */
export const capitalizeWords = (str: string): string => {
  return str.split(' ').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
};

/**
 * Retrieves a block's UID based on its exact text content.
 * This function is intended for internal use by other MCP tools.
 * @param graph The Roam graph instance.
 * @param blockText The exact text content of the block to find.
 * @returns The UID of the block if found, otherwise null.
 */
export const getBlockUidByText = async (graph: Graph, blockText: string): Promise<string | null> => {
  const query = `[:find ?uid .
                  :in $ ?blockString
                  :where [?b :block/string ?blockString]
                         [?b :block/uid ?uid]]`;
  const result = await q(graph, query, [blockText]) as [string][] | null;
  return result && result.length > 0 ? result[0][0] : null;
};

/**
 * Retrieves all UIDs nested under a given block_uid or block_text (exact match).
 * This function is intended for internal use by other MCP tools.
 * @param graph The Roam graph instance.
 * @param rootIdentifier The UID or exact text content of the root block.
 * @returns An array of UIDs of all descendant blocks, including the root block's UID.
 */
export const getNestedUids = async (graph: Graph, rootIdentifier: string): Promise<string[]> => {
  let rootUid: string | null = rootIdentifier;

  // If the rootIdentifier is not a UID (simple check for 9 alphanumeric characters), try to resolve it as block text
  if (!rootIdentifier.match(/^[a-zA-Z0-9]{9}$/)) {
    rootUid = await getBlockUidByText(graph, rootIdentifier);
  }

  if (!rootUid) {
    return []; // No root block found
  }

  const query = `[:find ?child-uid
                  :in $ ?root-uid
                  :where
                    [?root-block :block/uid ?root-uid]
                    [?root-block :block/children ?child-block]
                    [?child-block :block/uid ?child-uid]]`;

  const results = await q(graph, query, [rootUid]) as [string][];
  return results.map(r => r[0]);
};

/**
 * Retrieves all UIDs nested under a given block_text (exact match).
 * This function is intended for internal use by other MCP tools.
 * It strictly requires an exact text match for the root block.
 * @param graph The Roam graph instance.
 * @param blockText The exact text content of the root block.
 * @returns An array of UIDs of all descendant blocks, including the root block's UID.
 */
export const getNestedUidsByText = async (graph: Graph, blockText: string): Promise<string[]> => {
  const rootUid = await getBlockUidByText(graph, blockText);
  if (!rootUid) {
    return []; // No root block found with exact text match
  }
  return getNestedUids(graph, rootUid);
};
