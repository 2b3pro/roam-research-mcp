import { Graph, q } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { generateBlockUid } from '../../markdown-utils.js';
import { ANCESTOR_RULE } from '../../search/ancestor-rule.js';
import { sanitizeTagName } from '../../utils/helpers.js';
import { resolveRefs } from '../helpers/refs.js';
import { getOrCreateTodayPage } from '../helpers/page-resolution.js';
import { executeBatch } from '../helpers/batch-utils.js';
import { SearchOperations } from './search/index.js';
import type { SearchResult } from '../types/index.js';

export class MemoryOperations {
  private searchOps: SearchOperations;
  private memoriesTag: string | null;

  constructor(private graph: Graph, memoriesTag: string | null = 'Memories') {
    this.searchOps = new SearchOperations(graph);
    this.memoriesTag = memoriesTag;
  }

  async remember(
    memory: string,
    categories?: string[],
    heading?: string,
    parent_uid?: string,
    include_memories_tag: boolean = true
  ): Promise<{ success: boolean; block_uid?: string; parent_uid?: string }> {
    // Get or create today's daily page
    const pageUid = await getOrCreateTodayPage(this.graph);

    // Determine parent block for the memory
    let targetParentUid: string;

    if (parent_uid) {
      // Use provided parent_uid directly
      targetParentUid = parent_uid;
    } else if (heading) {
      // Search for heading block on today's page, create if not found
      const headingQuery = `[:find ?uid
                            :in $ ?page-uid ?text
                            :where
                            [?page :block/uid ?page-uid]
                            [?page :block/children ?block]
                            [?block :block/string ?text]
                            [?block :block/uid ?uid]]`;
      const headingResults = await q(this.graph, headingQuery, [pageUid, heading]) as [string][];

      if (headingResults && headingResults.length > 0) {
        targetParentUid = headingResults[0][0];
      } else {
        // Create the heading block
        const headingBlockUid = generateBlockUid();
        await executeBatch(this.graph, [{
          action: 'create-block',
          location: { 'parent-uid': pageUid, order: 'last' },
          block: { uid: headingBlockUid, string: heading }
        }], 'create heading block');
        targetParentUid = headingBlockUid;
      }
    } else {
      // Default: use daily page root
      targetParentUid = pageUid;
    }

    // Get memories tag (use instance property) and format as Roam tag
    // If memoriesTag is null (disabled for this graph), treat as if include_memories_tag is false
    const memoriesTagFormatted: string | undefined = (include_memories_tag && this.memoriesTag)
      ? (this.memoriesTag.includes(' ') || this.memoriesTag.includes('/')
          ? `#[[${this.memoriesTag}]]`
          : `#${this.memoriesTag}`)
      : undefined;

    // Format categories as Roam tags if provided (strip any pre-existing # or [[ ]] wrappers)
    const categoryTags = categories?.map(raw => {
      const cat = sanitizeTagName(raw);
      return cat.includes(' ') ? `#[[${cat}]]` : `#${cat}`;
    }) ?? [];

    // Create block with memory, then all tags together at the end
    const tags = memoriesTagFormatted ? [...categoryTags, memoriesTagFormatted] : categoryTags;
    const blockContent = [memory, ...tags].join(' ').trim();

    // Pre-generate UID so we can return it
    const blockUid = generateBlockUid();

    const actions = [{
      action: 'create-block',
      location: {
        'parent-uid': targetParentUid,
        order: 'last'
      },
      block: {
        uid: blockUid,
        string: blockContent
      }
    }];

    await executeBatch(this.graph, actions, 'create memory block');

    return { success: true, block_uid: blockUid, parent_uid: targetParentUid };
  }

  async recall(sort_by: 'newest' | 'oldest' = 'newest', filter_tag?: string): Promise<{ success: boolean; memories: string[] }> {
    // If memories tag is disabled for this graph, return empty
    if (!this.memoriesTag) {
      return { success: true, memories: [] };
    }

    // Extract the tag text, removing any formatting
    const tagText = this.memoriesTag
      .replace(/^#/, '')  // Remove leading #
      .replace(/^\[\[/, '').replace(/\]\]$/, '');  // Remove [[ and ]]

    try {
      // Query to find all blocks on the page
      const pageQuery = `[:find ?string ?time
                         :in $ % ?title
                         :where
                         [?page :node/title ?title]
                         [?block :block/string ?string]
                         [?block :create/time ?time]
                         (ancestor ?block ?page)]`;

      // Execute query
      const pageResults = await q(this.graph, pageQuery, [ANCESTOR_RULE, tagText]) as [string, number][];

      // Process page blocks with sorting
      let pageMemories = pageResults
        .sort(([_, aTime], [__, bTime]) => 
          sort_by === 'newest' ? bTime - aTime : aTime - bTime
        )
        .map(([content]) => content);

      // Get tagged blocks from across the graph
      const tagResults = await this.searchOps.searchForTag(tagText);
      
      // Process tagged blocks with sorting
      let taggedMemories = tagResults.matches
        .sort((a: SearchResult, b: SearchResult) => {
          const aTime = a.block_uid ? parseInt(a.block_uid.split('-')[0], 16) : 0;
          const bTime = b.block_uid ? parseInt(b.block_uid.split('-')[0], 16) : 0;
          return sort_by === 'newest' ? bTime - aTime : aTime - bTime;
        })
        .map(match => match.content);

      // Resolve any block references in both sets
      const resolvedPageMemories = await Promise.all(
        pageMemories.map(async (content: string) => resolveRefs(this.graph, content))
      );
      const resolvedTaggedMemories = await Promise.all(
        taggedMemories.map(async (content: string) => resolveRefs(this.graph, content))
      );

      // Combine both sets and remove duplicates while preserving order
      let uniqueMemories = [
        ...resolvedPageMemories,
        ...resolvedTaggedMemories
      ].filter((memory, index, self) => 
        self.indexOf(memory) === index
      );

      // Format filter tag with exact Roam tag syntax
      const filterTagFormatted = filter_tag ? 
      (filter_tag.includes(' ') ? `#[[${filter_tag}]]` : `#${filter_tag}`) : null;

      // Filter by exact tag match if provided
      if (filterTagFormatted) {
        uniqueMemories = uniqueMemories.filter(memory => memory.includes(filterTagFormatted));
      }
      
      // Format memories tag for removal and clean up memories tag
      const memoriesTagFormatted = tagText.includes(' ') || tagText.includes('/') ? `#[[${tagText}]]` : `#${tagText}`;
      uniqueMemories = uniqueMemories.map(memory => memory.replace(memoriesTagFormatted, '').trim());

      // return {
      //   success: true,
      //   memories: [
      //     `memoriesTag = ${memoriesTag}`,
      //     `filter_tag = ${filter_tag}`,
      //     `filterTagFormatted = ${filterTagFormatted}`,
      //     `memoriesTagFormatted = ${memoriesTagFormatted}`,
      //   ]
      // }
      return {
        success: true,
        memories: uniqueMemories
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to recall memories: ${error.message}`
      );
    }
  }
}
