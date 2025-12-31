import { Graph } from '@roam-research/roam-api-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PageOperations, type ContentItem } from './operations/pages.js';
import { BlockOperations } from './operations/blocks.js';
import { BlockRetrievalOperations } from './operations/block-retrieval.js';
import { SearchOperations } from './operations/search/index.js';
import { MemoryOperations } from './operations/memory.js';
import { TodoOperations } from './operations/todos.js';
import { OutlineOperations } from './operations/outline.js';
import { BatchOperations } from './operations/batch.js';
import { TableOperations, type TableInput } from './operations/table.js';
import { DatomicSearchHandlerImpl } from './operations/search/handlers.js';

export class ToolHandlers {
  private pageOps: PageOperations;
  private blockOps: BlockOperations;
  private blockRetrievalOps: BlockRetrievalOperations;
  private searchOps: SearchOperations;
  private memoryOps: MemoryOperations;
  private todoOps: TodoOperations;
  private outlineOps: OutlineOperations;
  private batchOps: BatchOperations;
  private tableOps: TableOperations;
  private cachedCheatsheet: string | null = null;

  constructor(private graph: Graph) {
    this.pageOps = new PageOperations(graph);
    this.blockOps = new BlockOperations(graph);
    this.blockRetrievalOps = new BlockRetrievalOperations(graph);
    this.searchOps = new SearchOperations(graph);
    this.memoryOps = new MemoryOperations(graph);
    this.todoOps = new TodoOperations(graph);
    this.outlineOps = new OutlineOperations(graph);
    this.batchOps = new BatchOperations(graph);
    this.tableOps = new TableOperations(graph);
  }

  // Page Operations
  async findPagesModifiedToday(limit: number = 50, offset: number = 0, sort_order: 'asc' | 'desc' = 'desc') {
    return this.pageOps.findPagesModifiedToday(limit, offset, sort_order);
  }

  async createPage(title: string, content?: ContentItem[]) {
    return this.pageOps.createPage(title, content);
  }

  async fetchPageByTitle(title: string, format?: 'markdown' | 'raw') {
    return this.pageOps.fetchPageByTitle(title, format);
  }

  // Block Operations
  async fetchBlockWithChildren(block_uid: string, depth?: number) {
    return this.blockRetrievalOps.fetchBlockWithChildren(block_uid, depth);
  }

  // Search Operations
  async searchByStatus(
    status: 'TODO' | 'DONE',
    page_title_uid?: string,
    include?: string,
    exclude?: string
  ) {
    return this.searchOps.searchByStatus(status, page_title_uid, include, exclude);
  }

  async searchForTag(
    primary_tag: string,
    page_title_uid?: string,
    near_tag?: string
  ) {
    return this.searchOps.searchForTag(primary_tag, page_title_uid, near_tag);
  }

  async searchBlockRefs(params: { block_uid?: string; title?: string; page_title_uid?: string }) {
    return this.searchOps.searchBlockRefs(params);
  }

  async searchHierarchy(params: {
    parent_uid?: string;
    child_uid?: string;
    page_title_uid?: string;
    max_depth?: number;
  }) {
    return this.searchOps.searchHierarchy(params);
  }

  async searchByText(params: {
    text: string;
    page_title_uid?: string;
  }) {
    return this.searchOps.searchByText(params);
  }

  async searchByDate(params: {
    start_date: string;
    end_date?: string;
    type: 'created' | 'modified' | 'both';
    scope: 'blocks' | 'pages' | 'both';
    include_content: boolean;
  }) {
    return this.searchOps.searchByDate(params);
  }

  // Datomic query
  async executeDatomicQuery(params: { query: string; inputs?: unknown[] }) {
    const handler = new DatomicSearchHandlerImpl(this.graph, params);
    return handler.execute();
  }

  // Memory Operations
  async remember(memory: string, categories?: string[]) {
    return this.memoryOps.remember(memory, categories);
  }

  async recall(sort_by: 'newest' | 'oldest' = 'newest', filter_tag?: string) {
    return this.memoryOps.recall(sort_by, filter_tag);
  }

  // Todo Operations
  async addTodos(todos: string[]) {
    return this.todoOps.addTodos(todos);
  }

  // Outline Operations
  async createOutline(outline: Array<{ text: string | undefined; level: number }>, page_title_uid?: string, block_text_uid?: string) {
    return this.outlineOps.createOutline(outline, page_title_uid, block_text_uid);
  }

  async importMarkdown(
    content: string,
    page_uid?: string,
    page_title?: string,
    parent_uid?: string,
    parent_string?: string,
    order: 'first' | 'last' = 'first'
  ) {
    return this.outlineOps.importMarkdown(content, page_uid, page_title, parent_uid, parent_string, order);
  }

  // Batch Operations
  async processBatch(actions: any[]) {
    return this.batchOps.processBatch(actions);
  }

  // Table Operations
  async createTable(input: TableInput) {
    return this.tableOps.createTable(input);
  }

  // Page Update with Diff
  async updatePageMarkdown(title: string, markdown: string, dryRun: boolean = false) {
    return this.pageOps.updatePageMarkdown(title, markdown, dryRun);
  }

  async getRoamMarkdownCheatsheet() {
    if (this.cachedCheatsheet) {
      return this.cachedCheatsheet;
    }

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const cheatsheetPath = path.join(__dirname, '../../Roam_Markdown_Cheatsheet.md');

    try {
      let cheatsheetContent = await fs.promises.readFile(cheatsheetPath, 'utf-8');

      const customInstructionsPath = process.env.CUSTOM_INSTRUCTIONS_PATH;
      if (customInstructionsPath) {
        try {
          // Check if file exists asynchronously
          await fs.promises.access(customInstructionsPath);
          const customInstructionsContent = await fs.promises.readFile(customInstructionsPath, 'utf-8');
          cheatsheetContent += `\n\n${customInstructionsContent}`;
        } catch (error) {
          // File doesn't exist or is not readable, ignore custom instructions
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn(`Could not read custom instructions file at ${customInstructionsPath}: ${error}`);
          }
        }
      }

      this.cachedCheatsheet = cheatsheetContent;
      return cheatsheetContent;
    } catch (error) {
      throw new Error(`Failed to read cheatsheet: ${error}`);
    }
  }
}
