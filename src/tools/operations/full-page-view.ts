import { Graph, q } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getPageUid as getPageUidHelper } from '../helpers/page-resolution.js';
import { resolveRefs } from '../helpers/refs.js';
import { fetchChildrenByDepth } from '../helpers/fetch-children.js';
import type { RoamBlock } from '../types/index.js';
import type { PageOperations } from './pages.js';

interface Breadcrumb {
  uid: string;
  string: string;
}

interface ReferenceWithContext {
  breadcrumbs: Breadcrumb[];
  block: RoamBlock;
}

interface LinkedReferenceGroup {
  source_page_title: string;
  source_page_uid: string;
  references: ReferenceWithContext[];
}

export class FullPageViewOperations {
  constructor(private graph: Graph, private pageOps: PageOperations) {}

  async fetchPageFullView(title: string, children_depth: number = 4, max_references: number = 200): Promise<string> {
    // 1. Get page UID
    const pageUid = await getPageUidHelper(this.graph, title);
    if (!pageUid) {
      throw new McpError(ErrorCode.InvalidRequest, `Page "${title}" not found`);
    }

    // 2. Fetch page's own blocks (reuse PageOperations to avoid duplication)
    const pageResult = await this.pageOps.fetchPageByUid(pageUid);
    const pageBlocks = pageResult?.blocks ?? [];

    // 3. Fetch all referring blocks (backlinks)
    const refResults = await this.fetchReferringBlocks(title);

    // Deduplicate by block_uid, then cap at max_references
    const seenUids = new Set<string>();
    const allUniqueRefs = refResults.filter(r => {
      if (seenUids.has(r.block_uid)) return false;
      seenUids.add(r.block_uid);
      return true;
    });
    const truncated = allUniqueRefs.length > max_references;
    const uniqueRefs = truncated ? allUniqueRefs.slice(0, max_references) : allUniqueRefs;

    const refBlockUids = uniqueRefs.map(r => r.block_uid);

    // 4. Fetch breadcrumbs (up) and children (down) in parallel
    const [breadcrumbsMap, childrenMap] = await Promise.all([
      this.fetchBreadcrumbs(refBlockUids),
      fetchChildrenByDepth(this.graph, refBlockUids, children_depth)
    ]);

    // 5. Resolve ((uid)) refs in all text before rendering
    // Page blocks
    const allPageBlocks: RoamBlock[] = [];
    const collectBlocks = (blocks: RoamBlock[]) => {
      for (const b of blocks) {
        allPageBlocks.push(b);
        collectBlocks(b.children);
      }
    };
    collectBlocks(pageBlocks);
    await Promise.all(allPageBlocks.map(async b => {
      b.string = await resolveRefs(this.graph, b.string);
    }));

    // Referring block strings
    const resolvedRefStrings = new Map<string, string>();
    await Promise.all(uniqueRefs.map(async r => {
      resolvedRefStrings.set(r.block_uid, await resolveRefs(this.graph, r.block_str));
    }));

    // Breadcrumb strings
    for (const uid of refBlockUids) {
      const crumbs = breadcrumbsMap[uid] || [];
      await Promise.all(crumbs.map(async crumb => {
        crumb.string = await resolveRefs(this.graph, crumb.string);
      }));
    }

    // Children strings
    const allChildBlocks: RoamBlock[] = [];
    for (const uid of refBlockUids) {
      const traverse = (blocks: RoamBlock[]) => {
        for (const b of blocks) {
          allChildBlocks.push(b);
          traverse(b.children);
        }
      };
      traverse(childrenMap[uid] || []);
    }
    await Promise.all(allChildBlocks.map(async b => {
      b.string = await resolveRefs(this.graph, b.string);
    }));

    // 6. Group by source page
    const groupMap = new Map<string, LinkedReferenceGroup>();
    for (const ref of uniqueRefs) {
      const key = ref.source_page_uid;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          source_page_title: ref.source_page_title,
          source_page_uid: ref.source_page_uid,
          references: []
        });
      }
      const refBlock: RoamBlock = {
        uid: ref.block_uid,
        string: resolvedRefStrings.get(ref.block_uid) || ref.block_str,
        order: 0,
        children: childrenMap[ref.block_uid] || []
      };
      groupMap.get(key)!.references.push({
        breadcrumbs: breadcrumbsMap[ref.block_uid] || [],
        block: refBlock
      });
    }

    const linkedReferenceGroups = Array.from(groupMap.values());

    // 7. Render as markdown
    return this.renderMarkdown(title, pageBlocks, linkedReferenceGroups, truncated ? allUniqueRefs.length : undefined);
  }

  // ─── Private: fetch all blocks that reference this page ──────────────────────

  private async fetchReferringBlocks(title: string): Promise<Array<{
    block_uid: string;
    block_str: string;
    source_page_title: string;
    source_page_uid: string;
  }>> {
    const query = `[:find ?block-uid ?block-str ?page-title ?page-uid
                   :in $ ?target-title
                   :where [?target :node/title ?target-title]
                          [?b :block/refs ?target]
                          [?b :block/uid ?block-uid]
                          [?b :block/string ?block-str]
                          [?b :block/page ?p]
                          [?p :node/title ?page-title]
                          [?p :block/uid ?page-uid]]`;
    const results = await q(this.graph, query, [title]) as [string, string, string, string][];
    if (!results || results.length === 0) return [];
    return results.map(([block_uid, block_str, source_page_title, source_page_uid]) => ({
      block_uid, block_str, source_page_title, source_page_uid
    }));
  }

  // ─── Private: walk UP the parent chain to collect breadcrumbs ────────────────
  //
  // Batches all UIDs at the same depth into a single query per level.
  // Page nodes have :node/title not :block/string → they won't match → natural stop.

  private async fetchBreadcrumbs(blockUids: string[]): Promise<Record<string, Breadcrumb[]>> {
    if (blockUids.length === 0) return {};

    const parentQuery = `[:find ?child-uid ?parent-uid ?parent-str
                         :in $ [?child-uid ...]
                         :where [?child :block/uid ?child-uid]
                                [?parent :block/children ?child]
                                [?parent :block/uid ?parent-uid]
                                [?parent :block/string ?parent-str]]`;

    // child → { uid, string } of its block parent
    const childToParent = new Map<string, { uid: string; string: string }>();

    let currentLevel = [...blockUids];
    while (currentLevel.length > 0) {
      const results = await q(this.graph, parentQuery, [currentLevel]) as [string, string, string][];
      if (!results || results.length === 0) break;

      const nextLevel: string[] = [];
      for (const [childUid, parentUid, parentStr] of results) {
        if (!childToParent.has(childUid)) {
          childToParent.set(childUid, { uid: parentUid, string: parentStr });
          nextLevel.push(parentUid);
        }
      }
      currentLevel = nextLevel;
    }

    // Reconstruct root-first breadcrumb chains per referring block
    const result: Record<string, Breadcrumb[]> = {};
    for (const refUid of blockUids) {
      const chain: Breadcrumb[] = [];
      let current = refUid;
      const seen = new Set<string>();
      while (childToParent.has(current) && !seen.has(current)) {
        seen.add(current);
        const parent = childToParent.get(current)!;
        chain.unshift({ uid: parent.uid, string: parent.string }); // prepend = root first
        current = parent.uid;
      }
      result[refUid] = chain;
    }

    return result;
  }

  // ─── Public: fetch sub-pages (namespace children) ────────────────────────────

  async fetchSubPages(prefix: string, filter_tag?: string, include_content: boolean = false): Promise<string> {
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;

    let pages: [string, string][];

    if (filter_tag) {
      const query = `[:find ?title ?uid
                     :in $ ?prefix ?tag
                     :where [?p :node/title ?title]
                            [?p :block/uid ?uid]
                            [(clojure.string/starts-with? ?title ?prefix)]
                            [?tag-page :node/title ?tag]
                            [?b :block/refs ?tag-page]
                            [?b :block/page ?p]]`;
      pages = await q(this.graph, query, [normalizedPrefix, filter_tag]) as [string, string][];
    } else {
      const query = `[:find ?title ?uid
                     :in $ ?prefix
                     :where [?p :node/title ?title]
                            [?p :block/uid ?uid]
                            [(clojure.string/starts-with? ?title ?prefix)]]`;
      pages = await q(this.graph, query, [normalizedPrefix]) as [string, string][];
    }

    if (!pages || pages.length === 0) {
      return `No sub-pages found for "${normalizedPrefix}"${filter_tag ? ` with tag "[[${filter_tag}]]"` : ''}.`;
    }

    pages.sort((a, b) => a[0].localeCompare(b[0]));

    const lines: string[] = [];
    lines.push(`# Sub-pages of "${prefix}" (${pages.length})`);
    if (filter_tag) lines.push(`*Filtered by tag: [[${filter_tag}]]*`);
    lines.push('');

    if (include_content) {
      for (const [title, uid] of pages) {
        lines.push(`## [[${title}]]`);
        lines.push('');
        const pageData = await this.pageOps.fetchPageByUid(uid);
        const blocks = pageData?.blocks ?? [];
        if (blocks.length > 0) {
          lines.push(this.renderBlocks(blocks, 0));
        } else {
          lines.push('*(no content)*');
        }
        lines.push('');
      }
    } else {
      for (const [title] of pages) {
        lines.push(`- [[${title}]]`);
      }
    }

    return lines.join('\n');
  }

  // ─── Private: render the full view as markdown ───────────────────────────────

  private renderMarkdown(
    title: string,
    pageBlocks: RoamBlock[],
    linkedRefs: LinkedReferenceGroup[],
    totalAvailable?: number
  ): string {
    const lines: string[] = [];

    // Page header and own content
    lines.push(`# ${title}`);
    lines.push('');
    if (pageBlocks.length > 0) {
      lines.push(this.renderBlocks(pageBlocks, 0));
    } else {
      lines.push('*(no content)*');
    }

    // Linked references section
    const totalRefs = linkedRefs.reduce((sum, g) => sum + g.references.length, 0);
    const truncationNote = totalAvailable !== undefined
      ? ` — *capped at ${totalRefs} of ${totalAvailable}; use max_references to increase*`
      : '';
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`## Linked References (${totalRefs} reference${totalRefs !== 1 ? 's' : ''} from ${linkedRefs.length} page${linkedRefs.length !== 1 ? 's' : ''}${truncationNote})`);

    if (totalRefs === 0) {
      lines.push('');
      lines.push('*(no linked references)*');
    } else {
      for (const group of linkedRefs) {
        lines.push('');
        lines.push('---');
        lines.push('');
        lines.push(`### [[${group.source_page_title}]]`);
        lines.push('');

        for (const ref of group.references) {
          // Breadcrumbs rendered as nested blockquotes (one > per level)
          // This mirrors Roam's ancestor context display
          for (let i = 0; i < ref.breadcrumbs.length; i++) {
            const prefix = '> '.repeat(i + 1);
            lines.push(`${prefix}${ref.breadcrumbs[i].string}`);
          }

          // The referring block itself, indented to sit visually under its breadcrumbs
          const refIndent = '  '.repeat(ref.breadcrumbs.length);
          lines.push(`${refIndent}- ${ref.block.string}`);

          // Children of the referring block
          if (ref.block.children.length > 0) {
            lines.push(this.renderBlocks(ref.block.children, ref.breadcrumbs.length + 1));
          }

          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  private renderBlocks(blocks: RoamBlock[], baseIndent: number): string {
    const renderBlock = (block: RoamBlock, depth: number): string => {
      const indent = '  '.repeat(depth);
      let line: string;
      if (block.heading && block.heading > 0) {
        const hashes = '#'.repeat(block.heading);
        line = `${indent}${hashes} ${block.string}`;
      } else {
        line = `${indent}- ${block.string}`;
      }
      const childLines = block.children.map(c => renderBlock(c, depth + 1)).join('\n');
      return childLines ? `${line}\n${childLines}` : line;
    };
    return blocks.map(b => renderBlock(b, baseIndent)).join('\n');
  }
}
