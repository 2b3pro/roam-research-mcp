import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatRoamDate } from '../../utils/helpers.js';

/**
 * Drives the real `roam batch` binary against the fake Roam backend and reads
 * back what it sent.
 *
 * `roam batch` had no tests, and its help text described three things the code
 * did not do (issues #34, #35, #36). Each of those is a claim about what
 * reaches Roam, so the write log is the evidence here: a dry run is proved by
 * an empty log, and a parent is proved by the `parent-uid` in the request body.
 *
 * Every run is its own process with its own copy of the fixture, so a page one
 * test creates does not exist for the next. Today's daily page is never in the
 * fixture up front (its title is the date), which is the case these tests need:
 * it is the page a careless dry run would create.
 *
 * Fixture (tests/fake-roam-backend.mjs): page "Test Page" (page00001).
 */

const CLI_ENTRY = 'build/cli/roam.js';
const PRELOAD = './tests/fake-roam-backend.mjs';

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Every body the process sent to Roam's write endpoint, in order. */
  writes: any[];
}

let scratch: string;
let runCount = 0;

beforeAll(() => {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`${CLI_ENTRY} not found — run \`npx tsc\` (or \`npm test\`) first.`);
  }
  scratch = mkdtempSync(join(tmpdir(), 'roam-batch-cli-test-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function batch(commands: unknown, ...flags: string[]): Run {
  const id = runCount++;
  const writeLog = join(scratch, `writes-${id}.jsonl`);
  const file = join(scratch, `commands-${id}.json`);
  writeFileSync(file, JSON.stringify(commands));

  // An inherited ROAM_GRAPHS outranks the single-graph vars and would aim the
  // run at a real graph.
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ROAM_')) delete env[key];
  }

  const result = spawnSync('node', ['--import', PRELOAD, CLI_ENTRY, 'batch', file, ...flags], {
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

/** Every block action the run sent, flattened out of its batch-actions calls. */
function blockActions(run: Run): any[] {
  return run.writes.flatMap((body) => (body.action === 'batch-actions' ? body.actions : [body]))
    .filter((action) => typeof action.action === 'string' && action.action.endsWith('-block'));
}

/** The one block action carrying this text. */
function blockWithText(run: Run, text: string): any {
  const found = blockActions(run).filter((action) => action.block?.string === text);
  expect(found, `block actions with text "${text}"`).toHaveLength(1);
  return found[0];
}

/** The page this run created through Roam's create-page call, by title. */
function createdPageTitles(run: Run): string[] {
  return run.writes.filter((body) => body.action === 'create-page').map((body) => body.page.title);
}

const today = () => formatRoamDate(new Date());

// Each test spawns a node process; a cold start under a parallel suite has
// been seen to pass vitest's 5s default.
vi.setConfig({ testTimeout: 20000 });

describe('roam batch: outline items (#34)', () => {
  it('accepts plain strings as level-1 items, as the help documents', () => {
    const run = batch([
      { command: 'outline', params: { parent: 'Test Page', items: ['Goal 1', 'Goal 2'] } },
    ]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(blockWithText(run, 'Goal 1').location['parent-uid']).toBe('page00001');
    expect(blockWithText(run, 'Goal 2').location['parent-uid']).toBe('page00001');
  });

  it('validates string items offline with --simulate', () => {
    // The exact report: this printed "Error: Invalid array length".
    const run = batch(
      [{ command: 'outline', params: { parent: 'AbCdEfGh1', items: ['Goal 1'] } }],
      '--simulate',
    );

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Batch actions: 1');
    expect(run.writes).toEqual([]);
  });

  it('defaults a missing level to 1 and nests objects under the item above them', () => {
    const run = batch([
      {
        command: 'outline',
        params: { parent: 'Test Page', items: ['A', { text: 'A1', level: 2 }, { text: 'B' }] },
      },
    ]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    const a = blockWithText(run, 'A');
    expect(a.location['parent-uid']).toBe('page00001');
    expect(blockWithText(run, 'A1').location['parent-uid']).toBe(a.block.uid);
    expect(blockWithText(run, 'B').location['parent-uid']).toBe('page00001');
  });

  it.each([
    ['a fraction', 1.5],
    ['a negative number', -1],
    ['zero', 0],
    ['a word', 'two'],
  ])('rejects a level that is %s, naming the item', (_label, level) => {
    const run = batch(
      [{ command: 'outline', params: { parent: 'AbCdEfGh1', items: ['fine', { text: 'bad', level }] } }],
      '--simulate',
    );

    expect(run.code).toBe(1);
    expect(run.stderr).not.toContain('Invalid array length');
    expect(run.stderr).toContain('[0] outline: items[1].level');
    expect(run.stderr).toContain(JSON.stringify(level));
    expect(run.writes).toEqual([]);
  });

  it.each([
    ['a number', 5, 'items[0]'],
    ['an object with no text', { level: 1 }, 'items[0].text'],
  ])('rejects an item that is %s, naming the item', (_label, item, where) => {
    const run = batch(
      [{ command: 'outline', params: { parent: 'AbCdEfGh1', items: [item] } }],
      '--simulate',
    );

    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`[0] outline: ${where}`);
    expect(run.writes).toEqual([]);
  });

  it('rejects items that are not a list', () => {
    const run = batch(
      [{ command: 'outline', params: { parent: 'AbCdEfGh1', items: 'Goal 1' } }],
      '--simulate',
    );

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("[0] outline: 'items' must be an array");
  });
});

describe('roam batch: a dry run writes nothing (#35)', () => {
  it('lists a parent page that does not exist yet, and does not create it', () => {
    const run = batch(
      [{ command: 'create', params: { parent: "A page that doesn't exist yet", text: 'x' } }],
      '--dry-run',
    );

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.writes).toEqual([]);
    expect(run.stdout).toContain('Page creations:');
    expect(run.stdout).toContain(`"A page that doesn't exist yet"`);
    expect(run.stdout).toContain('Total: 1 page(s), 1 action(s)');
  });

  it('does not create today\'s daily page for a bare todo', () => {
    const run = batch([{ command: 'todo', params: { text: 'Review project' } }], '--dry-run');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.writes).toEqual([]);
    expect(run.stdout).toContain(`"${today()}"`);
  });

  it('still plans against the real UID of a page that exists', () => {
    const run = batch(
      [{ command: 'create', params: { parent: 'Test Page', text: 'x' } }],
      '--dry-run',
    );

    expect(run.code).toBe(0);
    expect(run.writes).toEqual([]);
    expect(run.stdout).toContain('parent: page00001');
    expect(run.stdout).toContain('Total: 0 page(s), 1 action(s)');
  });

  it('still creates the missing parent page on a real run', () => {
    const run = batch([{ command: 'create', params: { parent: 'Brand New Page', text: 'x' } }]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    // How createPage makes a page: a link on today's daily page.
    const link = blockWithText(run, 'Created page: [[Brand New Page]]');
    const x = blockWithText(run, 'x');
    expect(x.location['parent-uid']).toMatch(/^p\d{8}$/);
    expect(x.location['parent-uid']).not.toBe(link.location['parent-uid']);
  });
});

describe('roam batch: --simulate needs no graph', () => {
  it('accepts page-title parents, "daily" and a bare todo without calling Roam', () => {
    const run = batch(
      [
        { command: 'create', params: { parent: 'Any Page Title', text: 'a' } },
        { command: 'create', params: { parent: 'daily', text: 'b' } },
        { command: 'todo', params: { text: 'c' } },
        { command: 'todo', params: { page: 'Another Page', text: 'd' } },
      ],
      '--simulate',
    );

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Batch actions: 4');
    expect(run.writes).toEqual([]);
  });
});

describe('roam batch: parent "daily" (#36)', () => {
  it('plans against today\'s daily page, not a page titled "daily"', () => {
    const run = batch([{ command: 'create', params: { parent: 'daily', text: 'x' } }], '--dry-run');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.writes).toEqual([]);
    expect(run.stdout).toContain(`"${today()}"`);
    expect(run.stdout).not.toContain('"daily"');
  });

  it('writes the block to today\'s daily page', () => {
    const run = batch([{ command: 'create', params: { parent: 'daily', text: 'x' } }]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    // The fixture starts without today's page, so the run creates it; that is
    // the only page it may create.
    expect(createdPageTitles(run)).toEqual([today()]);
    expect(JSON.stringify(run.writes)).not.toContain('[[daily]]');
    // Every block of this run sits on that one page, the new block included.
    const parents = new Set(blockActions(run).map((action) => action.location['parent-uid']));
    expect(parents.size).toBe(1);
    expect(blockWithText(run, 'x').location['parent-uid']).toMatch(/^p\d{8}$/);
  });

  it('resolves "daily" and page titles as the parent of a move', () => {
    const toDaily = batch([{ command: 'move', params: { uid: 'vis000001', parent: 'daily' } }]);

    expect(toDaily.stderr).toBe('');
    expect(toDaily.code).toBe(0);
    expect(createdPageTitles(toDaily)).toEqual([today()]);
    const dailyMove = blockActions(toDaily).find((action) => action.action === 'move-block');
    expect(dailyMove.location['parent-uid']).toMatch(/^p\d{8}$/);

    const toPage = batch([{ command: 'move', params: { uid: 'vis000001', parent: 'Test Page' } }]);

    expect(toPage.stderr).toBe('');
    expect(toPage.code).toBe(0);
    const pageMove = blockActions(toPage).find((action) => action.action === 'move-block');
    expect(pageMove.location['parent-uid']).toBe('page00001');
  });
});
