import { Graph, q } from '@roam-research/roam-api-sdk';

// Roam block UIDs are 9 alphanumeric characters (with _ and -)
const REF_PATTERN = /\(\(([a-zA-Z0-9_-]{9})\)\)/g;

/**
 * Extract all block UIDs referenced in text
 */
export function collectRefs(text: string): Set<string> {
  const refs = new Set<string>();
  let match;
  while ((match = REF_PATTERN.exec(text)) !== null) {
    refs.add(match[1]);
  }
  REF_PATTERN.lastIndex = 0; // Reset for reuse
  return refs;
}

/**
 * Resolve block references in text by replacing ((uid)) with block content.
 * Handles nested refs up to maxDepth, with circular reference protection.
 *
 * @param graph - Roam graph connection
 * @param text - Text containing ((uid)) references
 * @param depth - Current recursion depth (internal)
 * @param maxDepth - Maximum depth to resolve nested refs (default: 4)
 * @param seen - UIDs already resolved in this chain (circular protection)
 */
export async function resolveRefs(
  graph: Graph,
  text: string,
  depth: number = 0,
  maxDepth: number = 4,
  seen: Set<string> = new Set()
): Promise<string> {
  if (depth >= maxDepth) return text;

  const refs = collectRefs(text);
  if (refs.size === 0) return text;

  // Filter out already-seen refs to prevent circular resolution
  const newRefs = Array.from(refs).filter(uid => !seen.has(uid));
  if (newRefs.length === 0) return text;

  // Track these refs as seen
  newRefs.forEach(uid => seen.add(uid));

  // Batch fetch all referenced blocks
  const refQuery = `[:find ?uid ?string
                    :in $ [?uid ...]
                    :where [?b :block/uid ?uid]
                          [?b :block/string ?string]]`;
  const results = await q(graph, refQuery, [newRefs]) as [string, string][];

  // Build lookup map
  const refMap = new Map(results);

  // Collect refs that have nested refs needing resolution
  const nestedTexts = new Map<string, string>();
  for (const uid of newRefs) {
    const content = refMap.get(uid);
    if (content && collectRefs(content).size > 0) {
      nestedTexts.set(uid, content);
    }
  }

  // Resolve nested refs in parallel
  if (nestedTexts.size > 0) {
    const resolvedEntries = await Promise.all(
      Array.from(nestedTexts.entries()).map(async ([uid, content]) => {
        const resolved = await resolveRefs(graph, content, depth + 1, maxDepth, seen);
        return [uid, resolved] as const;
      })
    );
    resolvedEntries.forEach(([uid, resolved]) => refMap.set(uid, resolved));
  }

  // Replace all refs in a single pass
  return text.replace(REF_PATTERN, (match, uid) => {
    return refMap.get(uid) ?? match;
  });
}
