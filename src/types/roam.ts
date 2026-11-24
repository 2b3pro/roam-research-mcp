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

/** One of a block's versions. See src/tools/helpers/versions.ts. */
export interface RoamBlockVersion {
  uid: string;
  string: string;
  /** True for the version in use: the one a page read shows. */
  active: boolean;
}

export interface RoamBlockWithAncestors extends RoamBlock {
  ancestors?: RoamAncestor[];
  page_title?: string;
  /** Every version of this block, oldest first. Present only when it has more than one. */
  versions?: RoamBlockVersion[];
}

export type RoamBatchAction = {
  action: 'create-block' | 'update-block' | 'move-block' | 'delete-block' | 'create-page' | 'update-page' | 'delete-page';
  [key: string]: any;
};
