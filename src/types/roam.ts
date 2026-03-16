// Interface for Roam block structure
export interface RoamBlock {
  uid: string;
  string: string;
  order: number;
  heading?: number | null;
  children: RoamBlock[];
  refs?: RoamBlock[];
}

export interface RoamAncestor {
  uid: string;
  string?: string;
  title?: string;
  is_page?: boolean;
  depth: number;
}

export interface RoamBlockWithAncestors extends RoamBlock {
  ancestors?: RoamAncestor[];
  page_title?: string;
}

export type RoamBatchAction = {
  action: 'create-block' | 'update-block' | 'move-block' | 'delete-block' | 'create-page' | 'update-page' | 'delete-page';
  [key: string]: any;
};
