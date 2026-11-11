import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * Roam's backend accepts a `delete-block` for a UID that does not exist and
 * reports success. Confirmed against a live graph on 2026-11-11: an existence
 * query returned nothing, the delete returned `{success: true}`, and the
 * graph was unchanged. Passing that through tells an agent a block is gone
 * when a typo, a stale UID, or the wrong graph meant nothing happened.
 *
 * The fake backend reproduces the wire behaviour (every write succeeds), so
 * the only thing that can turn the silent no-op into a report is this server.
 */

const harness = new McpHarness({
  preload: './tests/fake-roam-backend.mjs',
  env: {
    ROAM_API_TOKEN: 'fake-token-for-tests',
    ROAM_GRAPH_NAME: 'fake-graph',
  },
});

beforeAll(() => harness.start(), 20000);
afterAll(() => harness.stop());

const batch = async (actions: unknown[]) => {
  const result = await harness.call('roam_process_batch_actions', { actions });
  return JSON.parse(McpHarness.text(result));
};

describe('delete-block on a UID that does not exist', () => {
  it('reports BLOCK_NOT_FOUND instead of success', async () => {
    const result = await batch([{ action: 'delete-block', uid: 'missing01' }]);

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('BLOCK_NOT_FOUND');
    expect(result.error.not_found).toEqual([{ action_index: 0, uid: 'missing01' }]);
    // Retrying cannot help: the UID is not there to delete.
    expect(result.error.recovery.suggestion).toMatch(/do not retry/i);
    // Nothing else was asked for, so nothing else is reported as committed.
    expect(result.committed).toBeUndefined();
  });

  it('still reports the rest of the batch as committed', async () => {
    const result = await batch([
      { action: 'create-block', uid: '{{uid:fresh}}', string: 'Kept', location: { 'parent-uid': 'page00001', order: 'last' } },
      { action: 'delete-block', uid: 'missing02' },
    ]);

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('BLOCK_NOT_FOUND');
    expect(result.error.not_found).toEqual([{ action_index: 1, uid: 'missing02' }]);
    expect(result.committed.action_indices).toEqual([0]);
    expect(result.committed.uids.fresh).toMatch(/^[A-Za-z0-9_-]{9}$/);
  });
});

describe('delete-block that has something to delete', () => {
  it('succeeds for an existing block', async () => {
    const result = await batch([{ action: 'delete-block', uid: 'vis000001' }]);
    expect(result).toMatchObject({ success: true, actions_attempted: 1 });
  });

  it('succeeds for a block created earlier in the same batch', async () => {
    // The pre-check runs before anything is written, so it cannot see this
    // block. It must not call it missing.
    const result = await batch([
      { action: 'create-block', uid: 'tmpblk001', string: 'Short-lived', location: { 'parent-uid': 'page00001', order: 'last' } },
      { action: 'delete-block', uid: 'tmpblk001' },
    ]);
    expect(result).toMatchObject({ success: true, actions_attempted: 2 });
  });
});
