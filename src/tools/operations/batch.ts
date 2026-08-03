import { Graph, batchActions as roamBatchActions } from '@roam-research/roam-api-sdk';
import { RoamBatchAction } from '../../types/roam.js';
import { generateBlockUid, parseMarkdownHeadingLevel } from '../../markdown-utils.js';
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
import { ensurePagesExist } from '../../shared/page-validator.js';
import { withRateLimitRetry, type RateLimitRetryConfig } from '../../shared/retry.js';

// Regex to match UID placeholders like {{uid:parent1}}, {{uid:section-a}}, etc.
const UID_PLACEHOLDER_REGEX = /\{\{uid:([^}]+)\}\}/g;

export interface BatchResult {
  success: boolean;
  uid_map?: Record<string, string>;  // placeholder name → generated UID (only on success)
  error?: string | StructuredError;
  validation_passed?: boolean;
  actions_attempted?: number;
}

/**
 * Kept as a local alias so existing importers are unaffected; the shape now
 * lives with the retry helper that consumes it.
 */
export type RateLimitConfig = RateLimitRetryConfig;

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
   * Executes the batch operation, retrying while Roam throttles us.
   *
   * This used to be a hand-rolled loop identical to the one in
   * `withRateLimitRetry`, which is precisely how `executeStagedBatch` came to
   * be written with no retry at all — the logic was private here, so the next
   * write path could not reuse it and simply went without. A half-written page
   * and no undo was the cost.
   *
   * On exhaustion the shared helper rethrows Roam's original error rather than
   * a synthesised one carrying `retryAfterMs`. `processBatch` never used that
   * field's value for anything the caller saw except the backoff hint, which
   * now comes from this instance's own config — a more honest source than
   * whatever happened to be stapled to an error object.
   */
  private async executeWithRetry(
    batchActions: RoamBatchAction[]
  ): Promise<void> {
    await withRateLimitRetry(
      () => roamBatchActions(this.graph, { actions: batchActions }),
      this.rateLimitConfig,
      (attempt, waitMs) =>
        console.log(
          `[batch] Rate limited, retrying in ${waitMs}ms (attempt ${attempt}/${this.rateLimitConfig.maxRetries})`
        )
    );
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

    // Step 0.5: Validate parent pages exist (auto-creates daily pages)
    // This uses batched queries and caching to minimize API calls
    try {
      const pageValidation = await ensurePagesExist(this.graph, actions, {
        maxRetries: this.rateLimitConfig.maxRetries,
        initialDelayMs: this.rateLimitConfig.initialDelayMs,
        maxDelayMs: this.rateLimitConfig.maxDelayMs,
        backoffMultiplier: this.rateLimitConfig.backoffMultiplier
      });

      if (pageValidation.created > 0) {
        console.log(`[batch] Auto-created ${pageValidation.created} daily page(s), checked ${pageValidation.checked}, cached ${pageValidation.cached}`);
      }
    } catch (error) {
      // Page validation failed - return structured error
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'PAGE_NOT_FOUND',
          message: errorMessage,
          recovery: {
            suggestion: 'Create the missing page(s) first with roam_create_page, or verify the parent-uid is correct'
          }
        },
        validation_passed: true,  // Syntax validation passed, page validation failed
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
      if (rest.string) {
        // Parse markdown heading syntax (e.g., "### Description" -> heading: 3, string: "Description")
        const { heading_level, content } = parseMarkdownHeadingLevel(rest.string);
        block.string = heading_level > 0 ? content : rest.string;

        // Use parsed heading level if not explicitly overridden
        if (heading_level > 0 && rest.heading === undefined) {
          block.heading = heading_level;
        }
      }
      if (rest.uid) block.uid = rest.uid;
      if (rest.open !== undefined) block.open = rest.open;
      // Explicit heading parameter takes precedence over markdown syntax
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

      // Check for parent entity error - retry once after delay (Roam eventual consistency)
      if (errorMessage.includes("Parent entity doesn't exist")) {
        console.log('[batch] Parent entity not found, retrying after 400ms...');
        await sleep(400);
        try {
          await this.executeWithRetry(batchActions);
          // SUCCESS on retry
          const result: BatchResult = {
            success: true,
            validation_passed: true,
            actions_attempted: batchActions.length
          };
          if (hasPlaceholders) {
            result.uid_map = uidMap;
          }
          return result;
        } catch (retryError) {
          // Still failed after retry
          const retryErrorMessage = retryError instanceof Error ? retryError.message : String(retryError);
          return {
            success: false,
            error: {
              code: 'PARENT_ENTITY_NOT_FOUND',
              message: `${retryErrorMessage} (retried once after 400ms delay)`,
              recovery: {
                suggestion: 'Verify the parent block/page UID exists and is spelled correctly'
              }
            },
            validation_passed: true,
            actions_attempted: batchActions.length
          };
        }
      }

      // Check if it's a rate limit error
      if (isRateLimitError(error)) {
        return {
          success: false,
          error: createRateLimitError(this.rateLimitConfig.maxDelayMs),
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
