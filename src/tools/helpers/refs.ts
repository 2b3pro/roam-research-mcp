import { Graph, q } from '@roam-research/roam-api-sdk';
import { RoamBlock } from '../../types/roam.js';

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

/**
 * Recursively resolves block references for a list of RoamBlocks.
 * Attaches referenced blocks to the `refs` property of the referencing block.
 * 
 * @param graph - Roam graph connection
 * @param blocksToScan - List of blocks to scan for references
 * @param remainingDepth - Maximum depth to resolve nested refs
 */
export async function resolveBlockRefs(
  graph: Graph, 
  blocksToScan: RoamBlock[], 
  remainingDepth: number = 2
): Promise<void> {
  if (remainingDepth <= 0 || blocksToScan.length === 0) {
    return;
  }

  const refMap: Record<string, RoamBlock[]> = {}; // uid -> list of blocks referencing it
  const allRefUids = new Set<string>();

  for (const block of blocksToScan) {
    // Skip blocks without valid string content
    if (typeof block.string !== 'string') {
      continue;
    }
    // Reset lastIndex for REF_PATTERN reuse if using exec, or use matchAll
    // matchAll is safer with global regex state
    const matches = block.string.matchAll(REF_PATTERN);
    for (const match of matches) {
      const refUid = match[1];
      if (!refMap[refUid]) {
        refMap[refUid] = [];
      }
      refMap[refUid].push(block);
      allRefUids.add(refUid);
    }
  }

  if (allRefUids.size === 0) {
    return;
  }

  const uidsToFetch = Array.from(allRefUids);
  
  // Fetch referenced blocks content
  const refsQuery = `[:find ?uid ?string ?heading
                      :in $ [?uid ...]
                      :where [?b :block/uid ?uid]
                             [?b :block/string ?string]
                             [(get-else $ ?b :block/heading 0) ?heading]]`;
  
  const results = await q(graph, refsQuery, [uidsToFetch]) as [string, string, number | null][];

  const fetchedBlocks: RoamBlock[] = [];

  for (const [uid, string, heading] of results) {
    const newBlock: RoamBlock = {
      uid,
      string,
      order: 0,
      heading: heading || undefined,
      children: [],
      refs: []
    };
    
    fetchedBlocks.push(newBlock);

    // Attach to parents
    if (refMap[uid]) {
      for (const parentBlock of refMap[uid]) {
         if (!parentBlock.refs) parentBlock.refs = [];
         // Avoid duplicates
         if (!parentBlock.refs.some(r => r.uid === uid)) {
           parentBlock.refs.push(newBlock);
         }
      }
    }
  }

  // Recurse for the next level of references
  await resolveBlockRefs(graph, fetchedBlocks, remainingDepth - 1);
}
