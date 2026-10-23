import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeGraph, q } from '@roam-research/roam-api-sdk';
import { roamHttpClient, parseRetryAfter } from './roam-http-client.js';
import { RoamError } from '../shared/errors.js';
import { withRateLimitRetry } from '../shared/retry.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Roam response metadata', () => {
  it('retains status, retry timing and partial progress through the actual SDK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: 'batch stopped', data: { 'num-actions-successfully-transacted-before-failure': 1 },
    }), { status: 429, headers: { 'Retry-After': '12' } })));
    const graph = initializeGraph({ token: 'secret-test-token', graph: 'fixture', httpClient: roamHttpClient });
    await expect(q(graph, 'probe', [])).rejects.toMatchObject({
      code: 'RATE_LIMIT', context: { http_status: 429, endpoint: 'q', retry_after_ms: 12000, num_actions_succeeded: 1 },
    });
  });

  it('supports both Retry-After forms and rejects invalid delays', () => {
    expect(parseRetryAfter('2.5')).toBe(2500);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:12 GMT', 2000)).toBe(10000);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:00 GMT', 2000)).toBe(0);
    for (const value of [null, '', '-1', 'bad']) expect(parseRetryAfter(value)).toBeUndefined();
  });

  it('does not expose request credentials or arbitrary response fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'response-secret', data: { secret: 1 } }), { status: 403 })));
    const failure = await roamHttpClient.call(new Request('https://api.roamresearch.com/api/graph/fixture/write', {
      method: 'POST', headers: { Authorization: 'Bearer request-secret' }, body: '{}',
    })).catch(error => error);
    expect(failure).toBeInstanceOf(RoamError);
    expect(JSON.stringify(failure)).not.toContain('secret');
    expect(failure.context).toMatchObject({ http_status: 403, outcome_unknown: true });
  });

  it('distinguishes an interrupted write from a confirmed rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(roamHttpClient.call(new Request('https://api.roamresearch.com/api/graph/fixture/write')))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR', context: { outcome_unknown: true } });
  });
});

describe('retry policy with transport evidence', () => {
  it('honors the server delay even above the client backoff cap', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValueOnce(new RoamError('throttled', 'RATE_LIMIT', { retry_after_ms: 12000, num_actions_succeeded: 0 }))
      .mockResolvedValue('ok');
    const pending = withRateLimitRetry(request, { initialDelayMs: 1, maxDelayMs: 1 });
    await vi.advanceTimersByTimeAsync(11999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('ok');
  });

  it.each([{ num_actions_succeeded: 1 }, { outcome_unknown: true }])('does not replay a write with %j', async context => {
    const request = vi.fn().mockRejectedValue(new RoamError('throttled', 'RATE_LIMIT', context));
    await expect(withRateLimitRetry(request, { initialDelayMs: 0 })).rejects.toBeInstanceOf(RoamError);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
