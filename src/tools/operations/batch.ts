import { Graph, batchActions as roamBatchActions } from '@roam-research/roam-api-sdk';
import { RoamBatchAction } from '../../types/roam.js';

export class BatchOperations {
  constructor(private graph: Graph) {}

  async processBatch(actions: any[]): Promise<any> {
    const batchActions: RoamBatchAction[] = actions.map(action => {
      const { action: actionType, ...rest } = action;
      const roamAction: any = { action: actionType };

      if (rest.location) {
        roamAction.location = {
          'parent-uid': rest.location['parent-uid'],
          order: rest.location.order,
        };
      }

      const block: any = {};
      if (rest.string) block.string = rest.string;
      if (rest.uid) block.uid = rest.uid;
      if (rest.open !== undefined) block.open = rest.open;
      if (rest.heading !== undefined && rest.heading !== null && rest.heading !== 0) {
        block.heading = rest.heading;
      }
      if (rest['text-align']) block['text-align'] = rest['text-align'];
      if (rest['children-view-type']) block['children-view-type'] = rest['children-view-type'];

      if (Object.keys(block).length > 0) {
        roamAction.block = block;
      }

      return roamAction;
    });

    return await roamBatchActions(this.graph, {actions: batchActions});
  }
}
