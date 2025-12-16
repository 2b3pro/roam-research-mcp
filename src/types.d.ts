declare module '@roam-research/roam-api-sdk' {
  interface Graph {
    token: string;
    graph: string;
  }

  interface RoamBlockLocation {
    'parent-uid': string;
    order: number | string;
  }

  interface RoamBlock {
    string: string;
    uid?: string;
    open?: boolean;
    heading?: number;
    'text-align'?: boolean;
    'children-view-type'?: string;
  }

  interface RoamCreateBlock {
    action?: 'create-block';
    location: RoamBlockLocation;
    block: RoamBlock;
  }

  export function initializeGraph(config: { token: string; graph: string }): Graph;
  
  export function q(
    graph: Graph,
    query: string,
    inputs: any[]
  ): Promise<any[]>;

  interface RoamCreatePage {
    action?: 'create-page';
    page: {
      title: string;
      uid?: string;
      'children-view-type'?: string;
    };
  }

  export function createPage(
    graph: Graph,
    options: RoamCreatePage
  ): Promise<boolean>;

  export function createBlock(
    graph: Graph,
    options: RoamCreateBlock
  ): Promise<boolean>;

  interface RoamUpdateBlock {
    action?: 'update-block';
    block: {
      string?: string;
      uid: string;
      open?: boolean;
      heading?: number;
      'text-align'?: boolean;
      'children-view-type'?: string;
    };
  }

  export function updateBlock(
    graph: Graph,
    options: RoamUpdateBlock
  ): Promise<boolean>;

  export function deleteBlock(
    graph: Graph,
    options: { uid: string }
  ): Promise<void>;

  export function pull(
    graph: Graph,
    pattern: string,
    eid: string
  ): Promise<any>;

  export function pull_many(
    graph: Graph,
    pattern: string,
    eids: string
  ): Promise<any>;

  interface RoamMoveBlock {
    action?: 'move-block';
    location: RoamBlockLocation;
    block: {
      uid: RoamBlock['uid'];
    };
  }

  export function moveBlock(
    graph: Graph,
    options: RoamMoveBlock
  ): Promise<boolean>;

  interface RoamDeletePage {
    action?: 'delete-page';
    page: {
      uid: string;
    };
  }

  export function deletePage(
    graph: Graph,
    options: RoamDeletePage
  ): Promise<boolean>;

  interface RoamDeleteBlock {
    action?: 'delete-block';
    block: {
      uid: string;
    };
  }

  export function deleteBlock(
    graph: Graph,
    options: RoamDeleteBlock
  ): Promise<boolean>;

  interface RoamBatchActions {
    action?: 'batch-actions';
    actions: Array<
      | RoamDeletePage
      | RoamUpdatePage
      | RoamCreatePage
      | RoamDeleteBlock
      | RoamUpdateBlock
      | RoamMoveBlock
      | RoamCreateBlock
    >;
  }

  export function batchActions(
    graph: Graph,
    options: RoamBatchActions
  ): Promise<any>;
}
