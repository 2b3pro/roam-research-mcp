import { RoamError } from '../shared/errors.js';

/** Keep response metadata before the Roam SDK reduces failures to messages. */
export const roamHttpClient = {
  async call(request: Request): Promise<Response> {
    const endpoint = new URL(request.url).pathname.split('/').pop() ?? '';
    const mutation = endpoint === 'write';
    let response: Response;
    try {
      response = await fetch(request);
    } catch (error) {
      throw new RoamError(`Roam request failed: ${error instanceof Error ? error.message : String(error)}`,
        'NETWORK_ERROR', { endpoint, ...(mutation && { outcome_unknown: true }) });
    }
    if (response.ok) return response;

    const body = await response.clone().json().catch(() => ({})) as Record<string, any>;
    const rawCount = body?.['num-actions-successfully-transacted-before-failure']
      ?? body?.data?.['num-actions-successfully-transacted-before-failure'];
    const count = Number.isSafeInteger(rawCount) && rawCount >= 0 ? rawCount as number : undefined;
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    const message = typeof body?.message === 'string' ? body.message
      : response.status === 429 ? 'Too many requests, try again after backoff.'
      : response.status === 401 ? "Invalid token or token doesn't have enough privileges."
      : `Roam HTTP ${response.status}`;
    throw new RoamError(message, response.status === 429 ? 'RATE_LIMIT' : 'API_ERROR', {
      http_status: response.status, endpoint,
      ...(retryAfter !== undefined && { retry_after_ms: retryAfter }),
      ...(count !== undefined && { num_actions_succeeded: count }),
      ...(mutation && { outcome_unknown: count === undefined }),
    });
  },
};

export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}
