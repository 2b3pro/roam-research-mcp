// Interface for Roam block structure
export interface RoamBlock {
  uid: string;
  string: string;
  order: number;
  heading?: number | null;
  children: RoamBlock[];
}

export type RoamBatchAction = {
  action: 'create-block' | 'update-block' | 'move-block' | 'delete-block';
  [key: string]: any;
};
