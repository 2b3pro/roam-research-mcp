import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Drives the real `roam rename` binary against the fake Roam backend and reads
 * back what it sent.
 *
 * `roam rename` printed "Renamed ..." and exited 0 for a request Roam does not
 * act on (issue #32), so the exit code and stdout prove nothing here. The
 * request body is the evidence: Roam renames a page only for
 * `{ action: 'update-page', page: { uid, title } }`.
 *
 * Fixture (tests/fake-roam-backend.mjs): pages "Rename By Uid" (renamePg1)
 * and "Rename By Title" (renamePg2).
 */

const CLI_ENTRY = 'build/cli/roam.js';
const PRELOAD = './tests/fake-roam-backend.mjs';

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Every body the process sent to Roam's write endpoint. */
  writes: unknown[];
}

let scratch: string;
let runCount = 0;

beforeAll(() => {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`${CLI_ENTRY} not found — run \`npx tsc\` (or \`npm test\`) first.`);
  }
  scratch = mkdtempSync(join(tmpdir(), 'roam-rename-cli-test-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function rename(...args: string[]): Run {
  const writeLog = join(scratch, `writes-${runCount++}.jsonl`);

  // An inherited ROAM_GRAPHS outranks the single-graph vars and would aim the
  // run at a real graph.
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ROAM_')) delete env[key];
  }

  const result = spawnSync('node', ['--import', PRELOAD, CLI_ENTRY, 'rename', ...args], {
    env: {
      ...env,
      ROAM_API_TOKEN: 'fake-token-for-tests',
      ROAM_GRAPH_NAME: 'fake-graph',
      FAKE_ROAM_WRITE_LOG: writeLog,
    } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 15000,
  });

  return {
    code: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr,
    writes: existsSync(writeLog)
      ? readFileSync(writeLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [],
  };
}

// Each test spawns a node process; a cold start under a parallel suite has
// been seen to pass vitest's 5s default.
vi.setConfig({ testTimeout: 20000 });

describe('roam rename', () => {
  it('renames by current title, sending the UID and new title inside page', () => {
    const run = rename('Rename By Title', 'Renamed By Title');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.writes).toEqual([
      { action: 'update-page', page: { uid: 'renamePg2', title: 'Renamed By Title' } },
    ]);
    expect(run.stdout).toBe('Renamed "Rename By Title" → "Renamed By Title"');
  });

  it('renames by --uid with the new title as the only argument', () => {
    // The form the help text has always shown. It used to stop at "missing
    // required argument 'new-title'".
    const run = rename('--uid', 'renamePg1', 'Renamed By Uid');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.writes).toEqual([
      { action: 'update-page', page: { uid: 'renamePg1', title: 'Renamed By Uid' } },
    ]);
    expect(run.stdout).toBe('Renamed ((renamePg1)) → "Renamed By Uid"');
  });

  it('still accepts a placeholder first argument with --uid', () => {
    // The only spelling that reached Roam before, so scripts may use it.
    const run = rename('ignored', 'Renamed By Uid', '--uid', 'renamePg1');

    expect(run.code).toBe(0);
    expect(run.writes).toEqual([
      { action: 'update-page', page: { uid: 'renamePg1', title: 'Renamed By Uid' } },
    ]);
  });

  it('exits nonzero with PAGE_NOT_FOUND for a title no page has, writing nothing', () => {
    const run = rename('No Such Page', 'Anything');

    expect(run.code).toBe(1);
    expect(run.stdout).toBe('');
    expect(JSON.parse(run.stderr).error.code).toBe('PAGE_NOT_FOUND');
    expect(run.writes).toEqual([]);
  });

  it('asks for a new title when a title rename is given only one argument', () => {
    const run = rename('Rename By Title');

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("missing required argument 'new-title'");
    expect(run.writes).toEqual([]);
  });
});
