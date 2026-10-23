import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('CLI context batching', () => {
  it('fetches five selected roots together and one shared child frontier', () => {
    const dir = mkdtempSync(join(tmpdir(), 'roam-get-batch-'));
    directories.push(dir);
    const log = join(dir, 'queries.jsonl');
    const result = spawnSync(process.execPath, ['--import', './tests/fake-roam-backend.mjs', 'build/cli/roam.js',
      'get', '--text', 'paging item', '--limit', '5', '--depth', '1', '--json'], {
      encoding: 'utf8', input: '', env: { ...process.env, ROAM_API_TOKEN: 'fake', ROAM_GRAPH_NAME: 'fake',
        ROAM_GRAPHS: '', ROAM_DEFAULT_GRAPH: '', FAKE_ROAM_QUERY_LOG: log },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).map((block: any) => block.uid))
      .toEqual(['pag000001', 'pag000002', 'pag000003', 'pag000004', 'pag000005']);
    const queries = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const roots = queries.filter(({ query }) => query.includes(':find ?uid ?string ?order ?heading'));
    expect(roots).toHaveLength(1);
    expect(roots[0].args[0]).toHaveLength(5);
    expect(queries.filter(({ query }) => query.includes(':find ?parentUid ?childUid'))).toHaveLength(1);
  });
});
