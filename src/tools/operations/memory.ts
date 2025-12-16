import { Graph, q, createPage, batchActions } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { formatRoamDate } from '../../utils/helpers.js';
import { resolveRefs } from '../helpers/refs.js';
import { SearchOperations } from './search/index.js';
import type { SearchResult } from '../types/index.js';

export class MemoryOperations {
  private searchOps: SearchOperations;

  constructor(private graph: Graph) {
    this.searchOps = new SearchOperations(graph);
  }

  async remember(memory: string, categories?: string[]): Promise<{ success: boolean }> {
    // Get today's date
    const today = new Date();
    const dateStr = formatRoamDate(today);
    
    // Try to find today's page
    const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
    const findResults = await q(this.graph, findQuery, [dateStr]) as [string][];
    
    let pageUid: string;
    
    if (findResults && findResults.length > 0) {
      pageUid = findResults[0][0];
    } else {
      // Create today's page if it doesn't exist
      try {
        await createPage(this.graph, {
          action: 'create-page',
          page: { title: dateStr }
        });

        // Get the new page's UID
        const results = await q(this.graph, findQuery, [dateStr]) as [string][];
        if (!results || results.length === 0) {
          throw new McpError(
            ErrorCode.InternalError,
            'Could not find created today\'s page'
          );
        }
        pageUid = results[0][0];
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          'Failed to create today\'s page'
        );
      }
    }

    // Get memories tag from environment
    const memoriesTag = process.env.MEMORIES_TAG;
    if (!memoriesTag) {
      throw new McpError(
        ErrorCode.InternalError,
        'MEMORIES_TAG environment variable not set'
      );
    }

    // Format categories as Roam tags if provided
    const categoryTags = categories?.map(cat => {
      // Handle multi-word categories
      return cat.includes(' ') ? `#[[${cat}]]` : `#${cat}`;
    }).join(' ') || '';

    // Create block with memory, memories tag, and optional categories
    const blockContent = `${memoriesTag} ${memory} ${categoryTags}`.trim();
    
    const actions = [{
      action: 'create-block',
      location: {
        'parent-uid': pageUid,
        order: 'last'
      },
      block: {
        string: blockContent
      }
    }];

    try {
      const result = await batchActions(this.graph, {
        action: 'batch-actions',
        actions
      });

      if (!result) {
        throw new McpError(
          ErrorCode.InternalError,
          'Failed to create memory block via batch action'
        );
      }
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create memory block: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return { success: true };
  }

  async recall(sort_by: 'newest' | 'oldest' = 'newest', filter_tag?: string): Promise<{ success: boolean; memories: string[] }> {
    // Get memories tag from environment
    var memoriesTag = process.env.MEMORIES_TAG;
    if (!memoriesTag) {
      memoriesTag = "Memories"
    }

    // Extract the tag text, removing any formatting
    const tagText = memoriesTag
      .replace(/^#/, '')  // Remove leading #
      .replace(/^\[\[/, '').replace(/\]\]$/, '');  // Remove [[ and ]]

    try {
      // Get page blocks using query to access actual block content
      const ancestorRule = `[
        [ (ancestor ?b ?a)
          [?a :block/children ?b] ]
        [ (ancestor ?b ?a)
          [?parent :block/children ?b]
          (ancestor ?parent ?a) ]
      ]`;

      // Query to find all blocks on the page
      const pageQuery = `[:find ?string ?time
                         :in $ % ?title
                         :where 
                         [?page :node/title ?title]
                         [?block :block/string ?string]
                         [?block :create/time ?time]
                         (ancestor ?block ?page)]`;
      
      // Execute query
      const pageResults = await q(this.graph, pageQuery, [ancestorRule, tagText]) as [string, number][];

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
