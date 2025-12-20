import { Graph, batchActions as roamBatchActions } from '@roam-research/roam-api-sdk';
import { RoamBatchAction } from '../../types/roam.js';
import { generateBlockUid } from '../../markdown-utils.js';

// Regex to match UID placeholders like {{uid:parent1}}, {{uid:section-a}}, etc.
const UID_PLACEHOLDER_REGEX = /\{\{uid:([^}]+)\}\}/g;

export interface BatchResult {
  success: boolean;
  uid_map?: Record<string, string>;  // placeholder name → generated UID
  error?: string;
}

export class BatchOperations {
  constructor(private graph: Graph) {}

  /**
   * Finds all unique UID placeholders in the actions and generates real UIDs for them.
   * Returns a map of placeholder name → generated UID.
   */
  private generateUidMap(actions: any[]): Record<string, string> {
    const placeholders = new Set<string>();
    const actionsJson = JSON.stringify(actions);

    let match;
    while ((match = UID_PLACEHOLDER_REGEX.exec(actionsJson)) !== null) {
      placeholders.add(match[1]);  // The placeholder name (e.g., "parent1")
    }

    const uidMap: Record<string, string> = {};
    for (const placeholder of placeholders) {
      uidMap[placeholder] = generateBlockUid();
    }

    return uidMap;
  }

  /**
   * Replaces all {{uid:*}} placeholders in a string with their generated UIDs.
   */
  private replacePlaceholders(value: string, uidMap: Record<string, string>): string {
    return value.replace(UID_PLACEHOLDER_REGEX, (_, name) => {
      return uidMap[name] || _;  // Return original if not found (shouldn't happen)
    });
  }

  /**
   * Recursively replaces placeholders in an object/array.
   */
  private replacePlaceholdersInObject(obj: any, uidMap: Record<string, string>): any {
    if (typeof obj === 'string') {
      return this.replacePlaceholders(obj, uidMap);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.replacePlaceholdersInObject(item, uidMap));
    }
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const key of Object.keys(obj)) {
        result[key] = this.replacePlaceholdersInObject(obj[key], uidMap);
      }
      return result;
    }
    return obj;
  }

  async processBatch(actions: any[]): Promise<BatchResult> {
    // Step 1: Generate UIDs for all placeholders
    const uidMap = this.generateUidMap(actions);
    const hasPlaceholders = Object.keys(uidMap).length > 0;

    // Step 2: Replace placeholders with real UIDs
    const processedActions = hasPlaceholders
      ? this.replacePlaceholdersInObject(actions, uidMap)
      : actions;

    // Step 3: Convert to Roam batch actions format
    const batchActions: RoamBatchAction[] = processedActions.map((action: any) => {
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

    try {
      await roamBatchActions(this.graph, { actions: batchActions });

      const result: BatchResult = { success: true };
      if (hasPlaceholders) {
        result.uid_map = uidMap;
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        uid_map: hasPlaceholders ? uidMap : undefined
      };
    }
  }
}
