import { Graph, q } from '@roam-research/roam-api-sdk';
import { RoamBlock } from '../../types/roam.js';
import { collectHiddenUids } from './hidden.js';

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
 * Expand a collection in breadth-first waves. Each UID (including a missing
 * target) is read once per invocation; cycle detection is per rendering path,
 * so a shared reference still expands independently in every branch.
 */
export async function resolveRefsMany(
  graph: Graph,
  texts: string[],
  maxDepth: number = 4,
  known: ReadonlyMap<string, string> = new Map(),
  seen: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  if (maxDepth <= 0) return texts.slice();
  let frontier = new Set(texts.flatMap(text => [...collectRefs(text)]));
  if (frontier.size === 0) return texts.slice();
  const hidden = await collectHiddenUids(graph);
  const contents = new Map<string, string | undefined>(known);
  const query = `[:find ?uid ?string
                  :in $ [?uid ...]
                  :where [?b :block/uid ?uid]
                         [?b :block/string ?string]]`;
  for (let depth = 0; depth < maxDepth && frontier.size > 0; depth++) {
    const readable = [...frontier].filter(uid => !hidden.has(uid) && !seen.has(uid));
    const missing = readable.filter(uid => !contents.has(uid));
    // Bound request size without turning a large result set into a burst.
    for (let i = 0; i < missing.length; i += 200) {
      const chunk = missing.slice(i, i + 200);
      const rows = await q(graph, query, [chunk]) as [string, string][];
      chunk.forEach(uid => contents.set(uid, undefined));
      for (const [uid, text] of rows) contents.set(uid, text);
    }
    frontier = new Set(readable.flatMap(uid => [...collectRefs(contents.get(uid) ?? '')]));
  }
  const render = (text: string, remaining: number, path: ReadonlySet<string>): string => {
    if (remaining <= 0) return text;
    return text.replace(REF_PATTERN, (reference, uid: string) => {
      const content = contents.get(uid);
      if (content === undefined || hidden.has(uid) || path.has(uid)) return reference;
      return render(content, remaining - 1, new Set([...path, uid]));
    });
  };
  return texts.map(text => render(text, maxDepth, seen));
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
  seen: Set<string> = new Set(),
): Promise<string> {
  return (await resolveRefsMany(graph, [text], maxDepth - depth, new Map(), seen))[0];
}

/** Expand a whole forest together, reusing raw content already loaded in it. */
export async function resolveRefsInTrees<T extends RoamBlock>(graph: Graph, blocks: T[], maxDepth: number): Promise<T[]> {
  const nodes: RoamBlock[] = [];
  const known = new Map<string, string>();
  const rememberRefs = (refs: RoamBlock[]) => {
    for (const ref of refs) {
      if (known.has(ref.uid)) continue;
      known.set(ref.uid, ref.string);
      rememberRefs(ref.refs ?? []);
    }
  };
  const clone = (block: RoamBlock): RoamBlock => {
    const copy = { ...block, children: block.children.map(clone) };
    nodes.push(copy);
    known.set(copy.uid, copy.string);
    rememberRefs(copy.refs ?? []);
    return copy;
  };
  const copies = blocks.map(clone) as T[];
  const strings = await resolveRefsMany(graph, nodes.map(block => block.string), maxDepth, known);
  nodes.forEach((block, index) => { block.string = strings[index]; });
  return copies;
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
  remainingDepth: number = 2,
  hidden: ReadonlySet<string> = new Set(),
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
      if (hidden.has(refUid)) continue;
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
  await resolveBlockRefs(graph, fetchedBlocks, remainingDepth - 1, hidden);
}
