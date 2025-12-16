import { Graph } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TagSearchHandler, BlockRefSearchHandler, HierarchySearchHandler, TextSearchHandler, DatomicSearchHandler, StatusSearchHandler } from '../../../search/index.js';
import type {
  TagSearchParams,
  BlockRefSearchParams,
  HierarchySearchParams,
  TextSearchParams,
  SearchHandlerResult,
  DatomicSearchParams,
  StatusSearchParams
} from './types.js';

// Base class for all search handlers
export abstract class BaseSearchHandler {
  constructor(protected graph: Graph) {}
  abstract execute(): Promise<SearchHandlerResult>;
}

// Tag search handler
export class TagSearchHandlerImpl extends BaseSearchHandler {
  constructor(graph: Graph, private params: TagSearchParams) {
    super(graph);
  }

  async execute() {
    const handler = new TagSearchHandler(this.graph, this.params);
    return handler.execute();
  }
}

// Block reference search handler
export class BlockRefSearchHandlerImpl extends BaseSearchHandler {
  constructor(graph: Graph, private params: BlockRefSearchParams) {
    super(graph);
  }

  async execute() {
    const handler = new BlockRefSearchHandler(this.graph, this.params);
    return handler.execute();
  }
}

// Hierarchy search handler
export class HierarchySearchHandlerImpl extends BaseSearchHandler {
  constructor(graph: Graph, private params: HierarchySearchParams) {
    super(graph);
  }

  async execute() {
    const handler = new HierarchySearchHandler(this.graph, this.params);
    return handler.execute();
  }
}

// Text search handler
export class TextSearchHandlerImpl extends BaseSearchHandler {
  constructor(graph: Graph, private params: TextSearchParams) {
    super(graph);
  }

  async execute() {
    const handler = new TextSearchHandler(this.graph, this.params);
    return handler.execute();
  }
}

// Status search handler
export class StatusSearchHandlerImpl extends BaseSearchHandler {
  constructor(graph: Graph, private params: StatusSearchParams) {
    super(graph);
  }

  async execute() {
    const handler = new StatusSearchHandler(this.graph, this.params);
    return handler.execute();
  }
}

// Datomic query handler
export class DatomicSearchHandlerImpl extends BaseSearchHandler {
  constructor(graph: Graph, private params: DatomicSearchParams) {
    super(graph);
  }

  async execute() {
    const handler = new DatomicSearchHandler(this.graph, this.params);
    return handler.execute();
  }
}
