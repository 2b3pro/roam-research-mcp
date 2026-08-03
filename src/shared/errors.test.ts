import { describe, it, expect } from 'vitest';
import { RoamError, toErrorResult } from './errors.js';

const bodyOf = (result: ReturnType<typeof toErrorResult>) =>
  JSON.parse(result.content[0].text).error as Record<string, unknown>;

describe('RoamError', () => {
  it('survives instanceof after transpilation', () => {
    const e = new RoamError('nope');
    expect(e instanceof RoamError).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(e.name).toBe('RoamError');
  });

  it('defaults to API_ERROR when no code is given', () => {
    expect(new RoamError('nope').code).toBe('API_ERROR');
  });

  it('accepts a code outside the known union', () => {
    // Codes come from Roam and from future transports; nothing may reject one
    // just because this codebase has not heard of it.
    const e = new RoamError('odd', 'SOMETHING_NEW_FROM_ROAM');
    expect(e.code).toBe('SOMETHING_NEW_FROM_ROAM');
  });
});

describe('toErrorResult', () => {
  it('marks the result as an error with a JSON body', () => {
    const r = toErrorResult(new RoamError('boom', 'PAGE_NOT_FOUND'));
    expect(r.isError).toBe(true);
    expect(r.content[0].type).toBe('text');
    expect(bodyOf(r)).toMatchObject({ code: 'PAGE_NOT_FOUND', message: 'boom' });
  });

  it('spreads context keys alongside code and message', () => {
    // This is the point of the whole envelope: the agent gets the facts it
    // needs to retry, not a sentence it has to parse.
    const r = toErrorResult(
      new RoamError('Unknown graph: "typo".', 'UNKNOWN_GRAPH', {
        requested_graph: 'typo',
        available_graphs: ['personal', 'work'],
      })
    );
    expect(bodyOf(r)).toEqual({
      code: 'UNKNOWN_GRAPH',
      message: 'Unknown graph: "typo".',
      requested_graph: 'typo',
      available_graphs: ['personal', 'work'],
    });
  });

  it('does not let context overwrite the message', () => {
    const r = toErrorResult(new RoamError('real message', 'API_ERROR', { extra: 1 }));
    expect(bodyOf(r).message).toBe('real message');
  });

  it('infers RATE_LIMIT for a throttling error raised elsewhere', () => {
    const r = toErrorResult(new Error('Too many requests, try again in a minute.'));
    expect(bodyOf(r).code).toBe('RATE_LIMIT');
  });

  it('infers NETWORK_ERROR for a connection failure', () => {
    const r = toErrorResult(new Error('connect ECONNREFUSED 127.0.0.1:8080'));
    expect(bodyOf(r).code).toBe('NETWORK_ERROR');
  });

  it('falls back to API_ERROR for anything else', () => {
    expect(bodyOf(toErrorResult(new Error('who knows'))).code).toBe('API_ERROR');
  });

  it('handles a thrown non-Error without crashing', () => {
    const r = toErrorResult('just a string');
    expect(bodyOf(r)).toMatchObject({ code: 'API_ERROR', message: 'just a string' });
  });
});
