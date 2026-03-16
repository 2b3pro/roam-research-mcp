import type { Breadcrumb } from './render-utils.js';

export function reconstructBreadcrumbChains(
  blockUids: string[],
  childToParent: Map<string, { uid: string; string: string }>
): Record<string, Breadcrumb[]> {
  const result: Record<string, Breadcrumb[]> = {};
  for (const refUid of blockUids) {
    const chain: Breadcrumb[] = [];
    let current = refUid;
    const seen = new Set<string>();
    while (childToParent.has(current) && !seen.has(current)) {
      seen.add(current);
      const parent = childToParent.get(current)!;
      chain.unshift({ uid: parent.uid, string: parent.string });
      current = parent.uid;
    }
    result[refUid] = chain;
  }
  return result;
}
