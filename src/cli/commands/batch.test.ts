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

describe('roam batch: the example in --help', () => {
  it('runs: a page placeholder works as a parent, and string outline items nest under a block', () => {
    const run = batch([
      { command: 'page', params: { title: 'Project X', as: 'proj' } },
      { command: 'create', params: { parent: '{{proj}}', text: '# Overview', as: 'overview' } },
      { command: 'outline', params: { parent: '{{overview}}', items: ['Goal 1', 'Goal 2'] } },
      { command: 'todo', params: { text: 'Review project' } },
    ]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    const output = JSON.parse(run.stdout);
    expect(output.success).toBe(true);
    expect(output.uid_map.proj).toMatch(/^p\d{8}$/);

    // The batch turns a leading "# " into a level-1 heading on its way out.
    const overview = blockWithText(run, 'Overview');
    expect(overview.block.heading).toBe(1);
    expect(overview.location['parent-uid']).toBe(output.uid_map.proj);
    expect(overview.block.uid).toBe(output.uid_map.overview);
    expect(blockWithText(run, 'Goal 1').location['parent-uid']).toBe(output.uid_map.overview);
    expect(blockWithText(run, 'Goal 2').location['parent-uid']).toBe(output.uid_map.overview);

    // The todo has no parent, so it belongs on today's daily page: the page
    // the "Created page" link for Project X was written to.
    const link = blockWithText(run, 'Created page: [[Project X]]');
    expect(blockWithText(run, '{{[[TODO]]}} Review project').location['parent-uid'])
      .toBe(link.location['parent-uid']);
  });
});

describe('roam batch: table (#40)', () => {
  /** The text of each block under `parentUid`, in the order Roam is told to put them. */
  function childrenOf(run: Run, parentUid: string): string[] {
    return blockActions(run)
      .filter((action) => action.location?.['parent-uid'] === parentUid)
      .sort((a, b) => a.location.order - b.location.order)
      .map((action) => action.block.string);
  }

  it('makes each row a child of the table block, each further column one level down', () => {
    // The table from the report. Roam reads a table row by row: a child of the
    // table block starts a row, and each cell after the first is the child of
    // the cell before it.
    const run = batch([
      {
        command: 'table',
        params: {
          parent: 'Test Page',
          headers: ['', 'H1', 'H2'],
          rows: [
            { label: 'R1', cells: ['a', 'b'] },
            { label: 'R2', cells: ['c', 'd'] },
          ],
        },
      },
    ]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    const table = blockWithText(run, '{{[[table]]}}');
    expect(table.location['parent-uid']).toBe('page00001');
    expect(childrenOf(run, table.block.uid)).toEqual([' ', 'R1', 'R2']);

    const under = (text: string) => childrenOf(run, blockWithText(run, text).block.uid);
    expect(under(' ')).toEqual(['H1']);
    expect(under('H1')).toEqual(['H2']);
    expect(under('H2')).toEqual([]);
    expect(under('R1')).toEqual(['a']);
    expect(under('a')).toEqual(['b']);
    expect(under('R2')).toEqual(['c']);
    expect(under('c')).toEqual(['d']);
  });

  it('keeps two tables in one batch apart', () => {
    const table = (corner: string, header: string, label: string, cell: string) => ({
      command: 'table',
      params: { parent: 'Test Page', headers: [corner, header], rows: [{ label, cells: [cell] }] },
    });
    const run = batch([table('first', 'P', 'p-row', 'p-cell'), table('second', 'Q', 'q-row', 'q-cell')]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    const tables = blockActions(run).filter((action) => action.block?.string === '{{[[table]]}}');
    expect(tables).toHaveLength(2);
    expect(tables[0].block.uid).not.toBe(tables[1].block.uid);
    expect(childrenOf(run, tables[0].block.uid)).toEqual(['first', 'p-row']);
    expect(childrenOf(run, tables[1].block.uid)).toEqual(['second', 'q-row']);
    const uids = blockActions(run).map((action) => action.block.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('names the table block with `as`, so a later command can use it as a parent', () => {
    const run = batch([
      {
        command: 'table',
        params: { parent: 'Test Page', as: 'tbl', headers: ['', 'H1'], rows: [{ label: 'R1', cells: ['a'] }] },
      },
      { command: 'create', params: { parent: '{{tbl}}', text: 'a row added afterwards' } },
    ]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    const table = blockWithText(run, '{{[[table]]}}');
    expect(JSON.parse(run.stdout).uid_map.tbl).toBe(table.block.uid);
    expect(blockWithText(run, 'a row added afterwards').location['parent-uid']).toBe(table.block.uid);
  });

  it.each([
    ['more cells than the headers leave room for', { label: 'R1', cells: ['a', 'b'] }, 'rows[0].cells'],
    ['fewer cells than the headers call for', { label: 'R1', cells: [] }, 'rows[0].cells'],
    ['no label', { cells: ['a'] }, 'rows[0].label'],
    ['no cells', { label: 'R1' }, 'rows[0].cells'],
  ])('refuses a row with %s, naming it, before anything is written', (_label, row, where) => {
    // The same check roam_create_table makes, so the two refuse the same tables.
    const run = batch([
      { command: 'table', params: { parent: 'Test Page', headers: ['', 'H1'], rows: [row] } },
    ]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`[0] table: ${where}`);
    expect(run.writes).toEqual([]);
  });
});

describe('roam batch: commands of one kind in one batch do not share blocks', () => {
  it('gives each of two outlines its own blocks', () => {
    // Blocks without an `as` were named with the clock, and two outlines
    // translated in the same millisecond got the same names: the second
    // outline's blocks were created under the first one's UIDs.
    const run = batch([
      { command: 'outline', params: { parent: 'Test Page', items: ['A-top', { text: 'A-child', level: 2 }] } },
      { command: 'outline', params: { parent: 'Test Page', items: ['B-top', { text: 'B-child', level: 2 }] } },
    ]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    const uid = (text: string) => blockWithText(run, text).block.uid;
    expect(new Set(['A-top', 'A-child', 'B-top', 'B-child'].map(uid)).size).toBe(4);
    expect(blockWithText(run, 'A-child').location['parent-uid']).toBe(uid('A-top'));
    expect(blockWithText(run, 'B-child').location['parent-uid']).toBe(uid('B-top'));
  });
});

describe('roam batch: codeblock', () => {
  it('writes a bare fence when no language is given, as the help allows', () => {
    const run = batch([{ command: 'codeblock', params: { parent: 'Test Page', code: 'x = 1' } }]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(blockWithText(run, '```\nx = 1\n```').location['parent-uid']).toBe('page00001');
  });

  it('puts a given language on the fence', () => {
    const run = batch([
      { command: 'codeblock', params: { parent: 'Test Page', code: 'x = 1', language: 'python' } },
    ]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(blockWithText(run, '```python\nx = 1\n```').location['parent-uid']).toBe('page00001');
  });
});

describe('roam batch: remember', () => {
  // roam_remember ends a memory with the graph's memories tag, which is how
  // roam_recall finds it again. `remember` in a batch wrote the text and the
  // categories and left the tag off, so the memory was saved where recall
  // would not look.
  it('ends the memory with the memories tag, as roam_remember does', () => {
    const run = batch([{ command: 'remember', params: { text: 'Likes green tea' } }]);

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    blockWithText(run, 'Likes green tea #Memories');
  });

  it('writes categories the way roam_remember does, before the memories tag', () => {
    const run = batch([
      { command: 'remember', params: { text: 'Prefers trains', categories: ['travel', 'long trips'] } },
    ]);

    expect(run.code).toBe(0);
    blockWithText(run, 'Prefers trains #travel #[[long trips]] #Memories');
  });

  it('leaves the tag off when include_memories_tag is false', () => {
    const run = batch([
      { command: 'remember', params: { text: 'Untagged note', categories: ['misc'], include_memories_tag: false } },
    ]);

    expect(run.code).toBe(0);
    blockWithText(run, 'Untagged note #misc');
  });

  it('plans the tag offline too', () => {
    const run = batch([{ command: 'remember', params: { text: 'Planned memory' } }], '--dry-run');

    expect(run.code).toBe(0);
    expect(run.writes).toEqual([]);
    expect(run.stdout).toContain('text: "Planned memory #Memories"');
  });
});
