/**
 * Structured error types for the Roam MCP server.
 * Provides consistent error handling across all tools.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BLOCK_NOT_FOUND'
  | 'PAGE_NOT_FOUND'
  | 'RATE_LIMIT'
  | 'API_ERROR'
  | 'TRANSACTION_FAILED'
  | 'NETWORK_ERROR';

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
