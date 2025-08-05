import { Graph } from '@roam-research/roam-api-sdk';
import type { RoamBlock } from '../../types/roam.js';

export interface ToolHandlerDependencies {
  graph: Graph;
}

export interface SearchResult {
  block_uid: string;
  content: string;
  page_title?: string;
}

export interface BlockUpdateResult {
  block_uid: string;
  content: string;
  success: boolean;
  error?: string;
}

export interface BlockUpdate {
  block_uid: string;
  content?: string;
  transform?: { 
    find: string;
    replace: string;
    global?: boolean;
  };
}

export interface OutlineItem {
  text: string | undefined;
  level: number;
  heading?: number;
  children_view_type?: 'bullet' | 'document' | 'numbered';
}

export interface NestedBlock {
  uid: string;
  text: string;
  level: number;
  children?: NestedBlock[];
}

export { RoamBlock };
