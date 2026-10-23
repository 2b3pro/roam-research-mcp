import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { McpHarness } from './testing/mcp-harness.js';

const dir = mkdtempSync(join(tmpdir(), 'roam-transport-'));
const log = join(dir, 'mcp-writes.jsonl');
const env = { ROAM_API_TOKEN: 'fake-token', ROAM_GRAPH_NAME: 'fake-graph' };
const harness = new McpHarness({ preload: './tests/failing-roam-backend.mjs', env: { ...env, FAKE_ROAM_WRITE_LOG: log } });
beforeAll(() => harness.start(), 20000);
afterAll(async () => { await harness.stop(); rmSync(dir, { recursive: true, force: true }); });

describe('transport metadata at caller boundaries', () => {
  it('survives an operation wrapper and reaches the MCP tool error', async () => {
    const result = await harness.call('roam_datomic_query', { query: 'error-probe' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(McpHarness.text(result)).error).toMatchObject({
      code: 'API_ERROR', http_status: 503, retry_after_ms: 2000, endpoint: 'q',
    });
  });

  it('reports a confirmed prefix without replaying or claiming whole-batch success', async () => {
    const result = await harness.call('roam_process_batch_actions', { actions: [
      { action: 'create-block', location: { 'parent-uid': 'page00001', order: 'last' }, string: 'first', uid: '{{uid:first}}' },
      { action: 'create-block', location: { 'parent-uid': 'page00001', order: 'last' }, string: 'second' },
    ] });
    const body = JSON.parse(McpHarness.text(result));
    expect(body.success).toBe(false);
    expect(body.uid_map).toBeUndefined();
    expect(body.error).toMatchObject({ code: 'RATE_LIMIT', http_status: 429, num_actions_succeeded: 1,
      recovery: { retry_after_ms: 7000 } });
    expect(body.committed.action_indices).toEqual([0]);
    const writes = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(writes).toHaveLength(1);
    expect(body.committed.uids.first).toBe(writes[0].actions[0].block.uid);
  });

  it('preserves the same failure details on CLI stderr', () => {
    const cliLog = join(dir, 'cli-writes.jsonl');
    const result = spawnSync(process.execPath, ['--import', './tests/failing-roam-backend.mjs', 'build/cli/roam.js', 'batch'], {
      encoding: 'utf8', env: { ...process.env, ...env, ROAM_GRAPHS: '', ROAM_DEFAULT_GRAPH: '', FAKE_ROAM_WRITE_LOG: cliLog },
      input: JSON.stringify([
        { command: 'create', params: { parent: 'page00001', text: 'one' } },
        { command: 'create', params: { parent: 'page00001', text: 'two' } },
      ]),
    });
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stderr);
    expect(body.error).toMatchObject({ http_status: 429, num_actions_succeeded: 1 });
    expect(body.committed.action_indices).toEqual([0]);
    expect(readFileSync(cliLog, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(result.stdout).toBe('');
  });

  it('preserves read failures through CLI error formatting', () => {
    const result = spawnSync(process.execPath, ['--import', './tests/failing-roam-backend.mjs', 'build/cli/roam.js', 'search', '-q', 'error-probe'], {
      encoding: 'utf8', input: '', env: { ...process.env, ...env, ROAM_GRAPHS: '', ROAM_DEFAULT_GRAPH: '' },
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr).error).toMatchObject({ code: 'API_ERROR', http_status: 503, retry_after_ms: 2000 });
    expect(result.stdout).toBe('');
  });
});
