import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { BaseSearchHandler, SearchResult } from './types.js';
// import { resolveRefs } from '../helpers/refs.js';

export interface DatomicSearchParams {
  query: string;
  inputs?: unknown[];
  regexFilter?: string;
  regexFlags?: string;
  regexTargetField?: string[];
}

export class DatomicSearchHandler extends BaseSearchHandler {
  constructor(
    graph: Graph,
    private params: DatomicSearchParams
  ) {
    super(graph);
  }

  async execute(): Promise<SearchResult> {
    try {
      // Execute the datomic query using the Roam API
      let results = await q(this.graph, this.params.query, this.params.inputs || []) as unknown[];

      if (this.params.regexFilter) {
        let regex: RegExp;
        try {
          regex = new RegExp(this.params.regexFilter, this.params.regexFlags);
        } catch (e) {
          return {
            success: false,
            matches: [],
            message: `Invalid regex filter provided: ${e instanceof Error ? e.message : String(e)}`
          };
        }

        results = results.filter(result => {
          if (this.params.regexTargetField && this.params.regexTargetField.length > 0) {
            for (const field of this.params.regexTargetField) {
              // Access nested fields if path is provided (e.g., "prop.nested")
              const fieldPath = field.split('.');
              let value: any = result;
              for (const part of fieldPath) {
                if (typeof value === 'object' && value !== null && part in value) {
                  value = value[part];
                } else {
                  value = undefined; // Field not found
                  break;
                }
              }
              if (typeof value === 'string' && regex.test(value)) {
                return true;
              }
            }
            return false;
          } else {
            // Default to stringifying the whole result if no target field is specified
            return regex.test(JSON.stringify(result));
          }
        });
      }

      return {
        success: true,
        matches: results.map(result => ({
          content: JSON.stringify(result),
          block_uid: '', // Datomic queries may not always return block UIDs
          page_title: '' // Datomic queries may not always return page titles
        })),
        message: `Query executed successfully. Found ${results.length} results.`
      };
    } catch (error) {
      return {
        success: false,
        matches: [],
        message: `Failed to execute query: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
