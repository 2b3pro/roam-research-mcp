import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Drives the real `roam save` binary against the fake Roam backend.
 *
 * The classifier and resolver have unit tests of their own. Those cannot prove
 * `save` calls them, or that it calls them BEFORE its first write, and "errors
 * with zero writes" is the claim that matters here. So these tests run the
 * built CLI as a subprocess, fake only the wire, and read back every write the
 * process made.
 *
 * Fixture (tests/fake-roam-backend.mjs): page "Save Fixture" (uid savePgAbc)
 * holding block nodigitAA and a block whose text is "Existing heading"
 * (uid exHeadAbc). All three UIDs are digit-free.
 */

const CLI_ENTRY = 'build/cli/roam.js';
const PRELOAD = './tests/fake-roam-backend.mjs';

interface Write {
  action: string;
  page?: { title: string };
  location?: { 'parent-uid': string };
  block?: { uid: string; string: string };
  actions?: Write[];
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Every create-block the process sent, batch-actions unpacked. */
  blocks: Write[];
  /** Every create-page the process sent. */
  pages: Write[];
}

let scratch: string;
let runCount = 0;

beforeAll(() => {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`${CLI_ENTRY} not found — run \`npx tsc\` (or \`npm test\`) first.`);
  }
  scratch = mkdtempSync(join(tmpdir(), 'roam-save-test-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function save(...args: string[]): Run {
  const writeLog = join(scratch, `writes-${runCount++}.jsonl`);

  // Same reasoning as the MCP harness: an inherited ROAM_GRAPHS outranks the
  // single-graph vars and would aim the run at a real graph name.
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ROAM_')) delete env[key];
  }

  const result = spawnSync('node', ['--import', PRELOAD, CLI_ENTRY, 'save', ...args], {
    env: {
      ...env,
      ROAM_API_TOKEN: 'fake-token-for-tests',
      ROAM_GRAPH_NAME: 'fake-graph',
      FAKE_ROAM_WRITE_LOG: writeLog,
    } as NodeJS.ProcessEnv,
    // stdin closed: `save` reads stdin when no input argument is given.
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 15000,
  });

  const writes: Write[] = existsSync(writeLog)
    ? readFileSync(writeLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const flat = writes.flatMap((w) => (w.action === 'batch-actions' ? w.actions ?? [] : [w]));

  return {
    code: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr,
    blocks: flat.filter((w) => w.action === 'create-block'),
    pages: flat.filter((w) => w.action === 'create-page'),
  };
}

const UID = /^[a-zA-Z0-9_-]{9}$/;

// Each test spawns a node process. A cold start while the rest of the suite
// runs in parallel has been seen to take 6s, past vitest's 5s default.
vi.setConfig({ testTimeout: 20000 });

describe('roam save --parent-uid', () => {
  it('nests under a digit-free UID and creates nothing else', () => {
    const run = save('--parent-uid', 'nodigitAA', 'child note');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(UID);
    expect(run.pages).toEqual([]);
    expect(run.blocks).toHaveLength(1);
    expect(run.blocks[0].location?.['parent-uid']).toBe('nodigitAA');
    expect(run.blocks[0].block?.string).toBe('child note');
  });

  it('accepts the ((uid)) wrapper', () => {
    const run = save('--parent-uid', '((nodigitAA))', 'child note');

    expect(run.code).toBe(0);
    expect(run.blocks).toHaveLength(1);
    expect(run.blocks[0].location?.['parent-uid']).toBe('nodigitAA');
  });

  it('errors with zero writes when the block does not exist', () => {
    const run = save('--parent-uid', 'zzzzzzzzz', 'child note');

    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain('zzzzzzzzz');
    expect(run.stdout).toBe('');
    expect(run.blocks).toEqual([]);
    expect(run.pages).toEqual([]);
  });

  it('errors with zero writes when the value is not a UID', () => {
    const run = save('--parent-uid', '## Notes', 'child note');

    expect(run.code).not.toBe(0);
    // The specific message, not just the flag name: commander's own "unknown
    // option '--parent-uid'" would satisfy a looser check on a build that does
    // not have the flag at all.
    expect(run.stderr).toMatch(/--parent-uid expects a 9-character block UID/);
    expect(run.blocks).toEqual([]);
    expect(run.pages).toEqual([]);
  });

  it('errors with zero writes when combined with --parent', () => {
    const run = save('--parent', '## Notes', '--parent-uid', 'nodigitAA', 'child note');

    expect(run.code).not.toBe(0);
    expect(run.stderr).toMatch(/--parent .*or --parent-uid .*not both/);
    expect(run.blocks).toEqual([]);
    expect(run.pages).toEqual([]);
  });
});

describe('roam save --parent with a UID (deprecated path)', () => {
  it('THE INCIDENT: a wrapped digit-free UID nests under that block, not under a stray ref block', () => {
    const run = save('--parent', '((nodigitAA))', 'child note');

    expect(run.code).toBe(0);
    // One UID on stdout. The bug printed two: the invented ref block's as well.
    expect(run.stdout).toMatch(UID);
    expect(run.pages).toEqual([]);
    expect(run.blocks).toHaveLength(1);
    expect(run.blocks[0].location?.['parent-uid']).toBe('nodigitAA');
    expect(run.blocks.some((b) => b.block?.string === '((nodigitAA))')).toBe(false);
  });

  it('prints a deprecation notice on stderr pointing at --parent-uid', () => {
    const run = save('--parent', '((nodigitAA))', 'child note');

    expect(run.stderr).toMatch(/deprecated/i);
    expect(run.stderr).toContain('--parent-uid');
  });

  it('errors with zero writes when the wrapped UID does not exist', () => {
    const run = save('--parent', '((zzzzzzzzz))', 'child note');

    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain('zzzzzzzzz');
    expect(run.blocks).toEqual([]);
    expect(run.pages).toEqual([]);
  });

  it('resolves a bare UID by asking the graph', () => {
    const run = save('--parent', 'nodigitAA', 'child note');

    expect(run.code).toBe(0);
    expect(run.blocks).toHaveLength(1);
    expect(run.blocks[0].location?.['parent-uid']).toBe('nodigitAA');
    expect(run.stderr).toMatch(/deprecated/i);
  });
});

describe('roam save --parent with text', () => {
  it('creates a missing heading and says so on stderr, leaving stdout alone', () => {
    const run = save('-p', 'Save Fixture', '--parent', '## Brand new', 'child note');

    expect(run.code).toBe(0);
    expect(run.pages).toEqual([]);

    const heading = run.blocks.find((b) => b.block?.string === 'Brand new');
    const child = run.blocks.find((b) => b.block?.string === 'child note');
    expect(heading?.location?.['parent-uid']).toBe('savePgAbc');
    expect(child?.location?.['parent-uid']).toBe(heading?.block?.uid);

    // Stdout contract unchanged: "<first block uid> <heading uid>".
    const [childUid, headingUid] = run.stdout.split(' ');
    expect(childUid).toMatch(UID);
    expect(headingUid).toBe(heading?.block?.uid);

    expect(run.stderr).toContain('Brand new');
    expect(run.stderr).toContain(headingUid);
    expect(run.stderr).not.toMatch(/deprecated/i);
  });

  it('reuses an existing heading silently', () => {
    const run = save('-p', 'Save Fixture', '--parent', 'Existing heading', 'child note');

    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.blocks).toHaveLength(1);
    expect(run.blocks[0].location?.['parent-uid']).toBe('exHeadAbc');
    expect(run.stdout.split(' ')[1]).toBe('exHeadAbc');
  });

  it('a bare 9-letter word that is not a UID in the graph is heading text', () => {
    const run = save('-p', 'Save Fixture', '--parent', 'Learnings', 'child note');

    expect(run.code).toBe(0);
    const heading = run.blocks.find((b) => b.block?.string === 'Learnings');
    expect(heading?.location?.['parent-uid']).toBe('savePgAbc');
    expect(run.blocks.some((b) => b.location?.['parent-uid'] === 'Learnings')).toBe(false);
  });
});

describe('roam save --page', () => {
  it('REGRESSION v2.15.1: -p Learnings resolves by title, never as a raw UID', () => {
    const run = save('-p', 'Learnings', 'note');

    expect(run.code).toBe(0);
    expect(run.pages.map((p) => p.page?.title)).toEqual(['Learnings']);
    expect(run.blocks).toHaveLength(1);
    expect(run.blocks[0].location?.['parent-uid']).not.toBe('Learnings');
  });

  it('a wrapped digit-free page UID is a UID, and no page is created', () => {
    const run = save('-p', '((savePgAbc))', 'note');

    expect(run.code).toBe(0);
    expect(run.pages).toEqual([]);
    expect(run.blocks).toHaveLength(1);
    expect(run.blocks[0].location?.['parent-uid']).toBe('savePgAbc');
  });

  it('a bare digit-free page UID is resolved by asking the graph', () => {
    const run = save('-p', 'savePgAbc', 'note');

    expect(run.code).toBe(0);
    expect(run.pages).toEqual([]);
    expect(run.blocks[0].location?.['parent-uid']).toBe('savePgAbc');
  });

  it('errors with zero writes when a wrapped page UID does not exist', () => {
    const run = save('-p', '((zzzzzzzzz))', 'note');

    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain('zzzzzzzzz');
    expect(run.blocks).toEqual([]);
    expect(run.pages).toEqual([]);
  });

  it('a missing parent UID errors before the target page is created', () => {
    const run = save('-p', 'A Page That Does Not Exist Yet', '--parent', '((zzzzzzzzz))', 'note');

    expect(run.code).not.toBe(0);
    expect(run.blocks).toEqual([]);
    expect(run.pages).toEqual([]);
  });
});
