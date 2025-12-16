import { Graph, q } from '@roam-research/roam-api-sdk';

/**
 * Collects all referenced block UIDs from text
 */
export const collectRefs = (text: string, depth: number = 0, refs: Set<string> = new Set()): Set<string> => {
  if (depth >= 4) return refs; // Max recursion depth
  
  const refRegex = /\(\(([a-zA-Z0-9_-]+)\)\)/g;
  let match;
  
  while ((match = refRegex.exec(text)) !== null) {
    const [_, uid] = match;
    refs.add(uid);
  }
  
  return refs;
};

/**
 * Resolves block references in text by replacing them with their content
 */
export const resolveRefs = async (graph: Graph, text: string, depth: number = 0): Promise<string> => {
  if (depth >= 4) return text; // Max recursion depth
  
  const refs = collectRefs(text, depth);
  if (refs.size === 0) return text;

  // Get referenced block contents
  const refQuery = `[:find ?uid ?string
                    :in $ [?uid ...]
                    :where [?b :block/uid ?uid]
                          [?b :block/string ?string]]`;
  const refResults = await q(graph, refQuery, [Array.from(refs)]) as [string, string][];
  
  // Create lookup map of uid -> string
  const refMap = new Map<string, string>();
  refResults.forEach(([uid, string]) => {
    refMap.set(uid, string);
  });
  
  // Replace references with their content
  let resolvedText = text;
  for (const uid of refs) {
    const refContent = refMap.get(uid);
    if (refContent) {
      // Recursively resolve nested references
      const resolvedContent = await resolveRefs(graph, refContent, depth + 1);
      resolvedText = resolvedText.replace(
        new RegExp(`\\(\\(${uid}\\)\\)`, 'g'),
        resolvedContent
      );
    }
  }
  
  return resolvedText;
};
