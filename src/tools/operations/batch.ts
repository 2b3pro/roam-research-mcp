import { Graph, batchActions as roamBatchActions } from '@roam-research/roam-api-sdk';
import { RoamBatchAction } from '../../types/roam.js';
import { generateBlockUid } from '../../markdown-utils.js';
import {
  validateBatchActions,
  formatValidationErrors,
  type BatchAction as ValidationBatchAction
} from '../../shared/validation.js';
import {
  isRateLimitError,
  createRateLimitError,
  type StructuredError
} from '../../shared/errors.js';

// Regex to match UID placeholders like {{uid:parent1}}, {{uid:section-a}}, etc.
const UID_PLACEHOLDER_REGEX = /\{\{uid:([^}]+)\}\}/g;

export interface BatchResult {
  success: boolean;
  uid_map?: Record<string, string>;  // placeholder name → generated UID (only on success)
  error?: string | StructuredError;
  validation_passed?: boolean;
  actions_attempted?: number;
}

export interface RateLimitConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2
};

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class BatchOperations {
  private rateLimitConfig: RateLimitConfig;

  constructor(
    private graph: Graph,
    rateLimitConfig?: Partial<RateLimitConfig>
  ) {
    this.rateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, ...rateLimitConfig };
  }

  /**
   * Finds all unique UID placeholders in the actions and generates real UIDs for them.
   * Returns a map of placeholder name → generated UID.
   */
  private generateUidMap(actions: any[]): Record<string, string> {
    const placeholders = new Set<string>();
    const actionsJson = JSON.stringify(actions);

    let match;
    // Reset regex lastIndex to ensure fresh matching
    UID_PLACEHOLDER_REGEX.lastIndex = 0;
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

  /**
   * Executes the batch operation with retry logic for rate limiting.
   */
  private async executeWithRetry(
    batchActions: RoamBatchAction[]
  ): Promise<void> {
    let lastError: Error | undefined;
    let delay = this.rateLimitConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.rateLimitConfig.maxRetries; attempt++) {
      try {
        await roamBatchActions(this.graph, { actions: batchActions });
        return;
      } catch (error) {
        if (!isRateLimitError(error)) {
          throw error;
        }

        lastError = error as Error;
        if (attempt < this.rateLimitConfig.maxRetries) {
          const waitTime = Math.min(delay, this.rateLimitConfig.maxDelayMs);
          console.log(`[batch] Rate limited, retrying in ${waitTime}ms (attempt ${attempt + 1}/${this.rateLimitConfig.maxRetries})`);
          await sleep(waitTime);
          delay *= this.rateLimitConfig.backoffMultiplier;
        }
      }
    }

    // Throw with rate limit context after all retries exhausted
    const rateLimitError = new Error(
      `Rate limit exceeded after ${this.rateLimitConfig.maxRetries} retries. ` +
      `Last error: ${lastError?.message || 'Unknown error'}. ` +
      `Retry after ${this.rateLimitConfig.maxDelayMs}ms.`
    );
    (rateLimitError as any).isRateLimit = true;
    (rateLimitError as any).retryAfterMs = this.rateLimitConfig.maxDelayMs;
    throw rateLimitError;
  }

  async processBatch(actions: any[]): Promise<BatchResult> {
    // Step 0: Pre-validate all actions before any execution
    const validationResult = validateBatchActions(actions as ValidationBatchAction[]);
    if (!validationResult.valid) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: formatValidationErrors(validationResult.errors),
          details: validationResult.errors.length > 0 ? {
            action_index: validationResult.errors[0].actionIndex,
            field: validationResult.errors[0].field,
            expected: validationResult.errors[0].expected,
            received: validationResult.errors[0].received
          } : undefined
        },
        validation_passed: false,
        actions_attempted: 0
      };
    }

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
      await this.executeWithRetry(batchActions);

      // SUCCESS: Return uid_map only on success
      const result: BatchResult = {
        success: true,
        validation_passed: true,
        actions_attempted: batchActions.length
      };
      if (hasPlaceholders) {
        result.uid_map = uidMap;
      }
      return result;
    } catch (error) {
      // FAILURE: Do NOT return uid_map - blocks don't exist
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if it's a rate limit error
      if (isRateLimitError(error) || (error as any).isRateLimit) {
        return {
          success: false,
          error: createRateLimitError((error as any).retryAfterMs),
          validation_passed: true,
          actions_attempted: batchActions.length
          // No uid_map - nothing was committed
        };
      }

      return {
        success: false,
        error: {
          code: 'TRANSACTION_FAILED',
          message: errorMessage,
          recovery: {
            suggestion: 'Check the error message and retry with corrected actions'
          }
        },
        validation_passed: true,
        actions_attempted: batchActions.length
        // No uid_map - nothing was committed (or we can't verify what was)
      };
    }
  }
}
