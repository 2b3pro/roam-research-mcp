/**
 * Structured error types for the Roam MCP server.
 * Provides consistent error handling across all tools.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BLOCK_NOT_FOUND'
  | 'PAGE_NOT_FOUND'
  | 'PARENT_ENTITY_NOT_FOUND'
  | 'RATE_LIMIT'
  | 'API_ERROR'
  | 'TRANSACTION_FAILED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_GRAPH'
  | 'WRITE_KEY_REQUIRED'
  | 'WRITE_KEY_NOT_CONFIGURED';

/**
 * A code the wire may carry. Deliberately widened beyond the union above:
 * adding a member here is safe, but nothing may VALIDATE an incoming code
 * against it — the Roam API and future transports emit codes this list has
 * never heard of, and rejecting them would lose information the agent needs.
 */
export type AnyErrorCode = ErrorCode | (string & {});

/**
 * An error carrying a machine-readable code and arbitrary recovery context.
 *
 * The context matters more than it looks: keys are spread into the error body
 * the agent receives, so a failure can ship the facts needed to fix it —
 * `available_graphs` on an unknown graph, a page title on a miss — instead of a
 * prose sentence the agent has to parse and usually can't act on.
 */
export class RoamError extends Error {
  constructor(
    message: string,
    public readonly code: AnyErrorCode = 'API_ERROR',
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RoamError';
    // Extending a builtin breaks instanceof under some transpile targets.
    Object.setPrototypeOf(this, RoamError.prototype);
  }
}

/**
 * The MCP tool-result shape for a failure. The index signature is what makes
 * this assignable to the SDK's ServerResult without importing the SDK here —
 * this module stays dependency-free so any transport can use it.
 */
export interface ErrorResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError: true;
}

/**
 * Render an error as an MCP tool result.
 *
 * Returned rather than thrown: MCP treats a thrown error as a protocol failure,
 * while `isError: true` with content is a *tool* failure the model can read and
 * act on. Context keys are spread alongside code and message.
 */
export function toErrorResult(error: unknown): ErrorResult {
  const isRoam = error instanceof RoamError;
  const body = {
    error: {
      code: isRoam ? error.code : inferCode(error),
      message: error instanceof Error ? error.message : String(error),
      ...(isRoam ? error.context ?? {} : {}),
    },
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    isError: true,
  };
}

/** Best-effort code for errors that were not raised as a RoamError. */
function inferCode(error: unknown): AnyErrorCode {
  if (isRateLimitError(error)) return 'RATE_LIMIT';
  if (isNetworkError(error)) return 'NETWORK_ERROR';
  return 'API_ERROR';
}

export interface ErrorDetails {
  action_index?: number;
  field?: string;
  expected?: string;
  received?: string;
}

export interface RecoveryHint {
  retry_after_ms?: number;
  suggestion?: string;
}

export interface CommittedState {
  action_indices: number[];
  uids: Record<string, string>;
}

export interface StructuredError {
  code: ErrorCode;
  message: string;
  details?: ErrorDetails;
  recovery?: RecoveryHint;
}

export interface McpErrorResponse {
  success: false;
  error: StructuredError;
  committed?: CommittedState;
}

export interface McpSuccessResponse<T = unknown> {
  success: true;
  data?: T;
}

/**
 * Creates a structured validation error response.
 */
export function createValidationError(
  message: string,
  details?: ErrorDetails,
  recovery?: RecoveryHint
): StructuredError {
  return {
    code: 'VALIDATION_ERROR',
    message,
    details,
    recovery
  };
}

/**
 * Creates a structured rate limit error response.
 */
export function createRateLimitError(
  retryAfterMs?: number
): StructuredError {
  return {
    code: 'RATE_LIMIT',
    message: 'Too many requests, please retry after backoff',
    recovery: {
      retry_after_ms: retryAfterMs ?? 60000,
      suggestion: 'Wait for the specified duration before retrying'
    }
  };
}

/**
 * Creates a structured API error response.
 */
export function createApiError(
  message: string,
  details?: ErrorDetails
): StructuredError {
  return {
    code: 'API_ERROR',
    message,
    details
  };
}

/**
 * Creates a structured transaction failed error response.
 */
export function createTransactionFailedError(
  message: string,
  failedAtAction?: number,
  committed?: CommittedState
): McpErrorResponse {
  return {
    success: false,
    error: {
      code: 'TRANSACTION_FAILED',
      message,
      details: failedAtAction !== undefined ? { action_index: failedAtAction } : undefined
    },
    committed
  };
}

/**
 * Checks if an error is a rate limit error based on error message.
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('too many requests') ||
           message.includes('rate limit') ||
           message.includes('try again in');
  }
  if (typeof error === 'string') {
    const message = error.toLowerCase();
    return message.includes('too many requests') ||
           message.includes('rate limit') ||
           message.includes('try again in');
  }
  return false;
}

/**
 * Checks if an error is a network error.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('network') ||
           message.includes('econnrefused') ||
           message.includes('econnreset') ||
           message.includes('etimedout') ||
           message.includes('socket');
  }
  return false;
}
