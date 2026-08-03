import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * The write gate, exercised through `tools/call`.
 *
 * Unit tests on GraphRegistry can only prove `validateWriteAccess` throws. They
 * cannot prove a tool call reaches it, that the refusal survives the transport,
 * or — the reason this file exists — that the refusal does not hand back the
 * key it just refused. That defect was real: the error message used to include
 * `Provide write_key: "<the actual key>"`, which made the gate decorative for
 * exactly the caller it was meant to stop.
 */

/** Distinctive so a leak anywhere in the response is unmistakable. */
const WRITE_KEY = 'k3y-should-never-appear-in-any-output';

const graphs = JSON.stringify({
  personal: { token: 'fake-token', graph: 'fake-personal' },
  work: { token: 'fake-token', graph: 'fake-work', protected: true },
});

const harness = new McpHarness({
  preload: './tests/fake-roam-backend.mjs',
  env: {
    ROAM_GRAPHS: graphs,
    ROAM_DEFAULT_GRAPH: 'personal',
    ROAM_SYSTEM_WRITE_KEY: WRITE_KEY,
  },
});

beforeAll(() => harness.start(), 20000);
afterAll(() => harness.stop());

/** The `{ error: { code, message, ...context } }` envelope a RoamError becomes. */
function errorBody(text: string): { code: string; message: string; [k: string]: unknown } {
  return JSON.parse(text).error;
}

describe('writing to a protected graph', () => {
  it('refuses without a write key, and says what is required', async () => {
    const result = await harness.call('roam_rename_page', {
      graph: 'work',
      page_title: 'Test Page',
      new_title: 'Renamed',
    });

    expect(result.isError).toBe(true);
    const error = errorBody(McpHarness.text(result));
    expect(error.code).toBe('WRITE_KEY_REQUIRED');
    expect(error.graph).toBe('work');
    expect(error.required_parameter).toBe('write_key');
    expect(error.message).toContain('ROAM_SYSTEM_WRITE_KEY');
  });

  it('never echoes the key it is refusing', async () => {
    // The whole response, not just the message: context fields are spread into
    // the error body, so a key leaking through one of those is just as bad.
    const result = await harness.call('roam_rename_page', {
      graph: 'work',
      page_title: 'Test Page',
      new_title: 'Renamed',
    });
    expect(JSON.stringify(result)).not.toContain(WRITE_KEY);
  });

  it('does not leak the key on a WRONG guess either', async () => {
    // The tempting failure mode: telling a caller who guessed wrong what the
    // right answer was.
    const result = await harness.call('roam_rename_page', {
      graph: 'work',
      write_key: 'wrong-guess',
      page_title: 'Test Page',
      new_title: 'Renamed',
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(WRITE_KEY);
  });

  it('opens the gate for the correct key', async () => {
    const result = await harness.call('roam_rename_page', {
      graph: 'work',
      write_key: WRITE_KEY,
      page_title: 'Test Page',
      new_title: 'Renamed',
    });
    // Whatever happens downstream against a fixtured backend, it must no longer
    // be the write gate refusing.
    expect(McpHarness.text(result)).not.toContain('WRITE_KEY_REQUIRED');
  });

  it('lets reads through with no key at all', async () => {
    const result = await harness.call('roam_fetch_page_by_title', {
      graph: 'work',
      title: 'Test Page',
      format: 'markdown',
    });
    expect(result.isError).toBeFalsy();
    expect(McpHarness.text(result)).toContain('First visible block');
  });
});

describe('an unknown graph', () => {
  it('names the graphs that do exist, so the agent can retry', async () => {
    const result = await harness.call('roam_fetch_page_by_title', {
      graph: 'nonexistent',
      title: 'Test Page',
    });

    expect(result.isError).toBe(true);
    const error = errorBody(McpHarness.text(result));
    expect(error.code).toBe('UNKNOWN_GRAPH');
    expect(error.available_graphs).toEqual(['personal', 'work']);
  });
});

describe('the default graph', () => {
  const defaultProtected = new McpHarness({
    preload: './tests/fake-roam-backend.mjs',
    env: {
      ROAM_GRAPHS: JSON.stringify({
        personal: { token: 'fake-token', graph: 'fake-personal', protected: true },
      }),
      ROAM_DEFAULT_GRAPH: 'personal',
      ROAM_SYSTEM_WRITE_KEY: WRITE_KEY,
    },
  });

  beforeAll(() => defaultProtected.start(), 20000);
  afterAll(() => defaultProtected.stop());

  it('bypasses protection even when marked protected', async () => {
    // Pinning a sharp edge, not endorsing it: `isWriteAllowed` returns true for
    // the default graph before it ever looks at `protected`. Someone who sets
    // `protected: true` on their default graph gets no protection and no
    // warning. If that rule ever changes, this test is where it surfaces.
    const result = await defaultProtected.call('roam_rename_page', {
      page_title: 'Test Page',
      new_title: 'Renamed',
    });
    expect(McpHarness.text(result)).not.toContain('WRITE_KEY_REQUIRED');
  });
});
