import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  block?: { uid: string; string: string; heading?: number };
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
  /** Every move-block the process sent. */
  moves: Write[];
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
    moves: flat.filter((w) => w.action === 'move-block'),
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

describe('roam save --parent with a UID-shaped value (5.0: always text)', () => {
  it('a wrapped UID finds or creates a reference block and nests under it', () => {
    const run = save('-p', 'Save Fixture', '--parent', '((nodigitAA))', 'child note');

    expect(run.code).toBe(0);
    expect(run.pages).toEqual([]);

    const ref = run.blocks.find((b) => b.block?.string === '((nodigitAA))');
    const child = run.blocks.find((b) => b.block?.string === 'child note');
    expect(ref?.location?.['parent-uid']).toBe('savePgAbc');
    expect(child?.location?.['parent-uid']).toBe(ref?.block?.uid);

    // Nothing is written under the referenced block itself.
    expect(run.blocks.some((b) => b.location?.['parent-uid'] === 'nodigitAA')).toBe(false);

    // Stdout: "<first block uid> <parent uid>", as for any --parent text.
    expect(run.stdout.split(' ')[1]).toBe(ref?.block?.uid);

    // The creation is announced; the 4.1 deprecation warning is gone.
    expect(run.stderr).toContain('((nodigitAA))');
    expect(run.stderr).toContain(ref?.block?.uid);
    expect(run.stderr).not.toMatch(/deprecated/i);
  });

  it('says how to nest under the block itself when it creates a reference block', () => {
    const run = save('-p', 'Save Fixture', '--parent', '((nodigitAA))', 'child note');

    expect(run.stderr).toContain('--parent is always text');
    expect(run.stderr).toContain('--parent-uid nodigitAA');
  });

  it('gives the same guidance for a bare UID', () => {
    const run = save('-p', 'Save Fixture', '--parent', 'nodigitAA', 'child note');

    expect(run.stderr).toContain('--parent is always text');
    expect(run.stderr).toContain('--parent-uid nodigitAA');
  });

  it('stays silent when the reference block already exists', () => {
    const run = save('-p', 'Save Fixture', '--parent', '((exHeadAbc))', 'child note');

    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.blocks).toHaveLength(1);
    expect(run.blocks[0].location?.['parent-uid']).toBe('exRefAbcd');
  });

  it('behaves the same whether or not the UID contains a digit', () => {
    // nodigitAA is digit-free, page00001 has digits. Neither is looked up.
    for (const uid of ['nodigitAA', 'page00001']) {
      const run = save('-p', 'Save Fixture', '--parent', `((${uid}))`, 'child note');

      expect(run.code).toBe(0);
      const ref = run.blocks.find((b) => b.block?.string === `((${uid}))`);
      expect(ref?.location?.['parent-uid']).toBe('savePgAbc');
      expect(run.blocks.some((b) => b.location?.['parent-uid'] === uid)).toBe(false);
    }
  });

  it('a wrapped UID that names nothing is still text, not an error', () => {
    const run = save('-p', 'Save Fixture', '--parent', '((zzzzzzzzz))', 'child note');

    expect(run.code).toBe(0);
    const ref = run.blocks.find((b) => b.block?.string === '((zzzzzzzzz))');
    expect(ref?.location?.['parent-uid']).toBe('savePgAbc');
  });

  it('a bare UID is text, even when that block exists', () => {
    const run = save('-p', 'Save Fixture', '--parent', 'nodigitAA', 'child note');

    expect(run.code).toBe(0);
    const heading = run.blocks.find((b) => b.block?.string === 'nodigitAA');
    expect(heading?.location?.['parent-uid']).toBe('savePgAbc');
    expect(run.blocks.some((b) => b.location?.['parent-uid'] === 'nodigitAA')).toBe(false);
    expect(run.stderr).not.toMatch(/deprecated/i);
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
    // Plain heading text is not UID-shaped, so there is nothing to hint at.
    expect(run.stderr).not.toContain('--parent-uid');
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
    const run = save('-p', 'A Page That Does Not Exist Yet', '--parent-uid', 'zzzzzzzzz', 'note');

    expect(run.code).not.toBe(0);
    expect(run.blocks).toEqual([]);
    expect(run.pages).toEqual([]);
  });
});

describe('roam save --help', () => {
  const help = () => {
    const run = save('--help');
    return run.stdout + run.stderr;
  };

  it('explains how to choose between the two parent flags, before the examples', () => {
    const text = help();

    const guidance = text.indexOf('Choosing a parent block');
    expect(guidance).toBeGreaterThan(-1);
    expect(guidance).toBeLessThan(text.indexOf('Examples:'));
  });

  it('says outright that --parent is never a UID and what "((uid))" means there', () => {
    const text = help().replace(/\s+/g, ' ');

    expect(text).toMatch(/--parent[^.]*never a UID/i);
    expect(text).toMatch(/\(\(uid\)\)[^.]*(containing|contains) that reference/i);
    expect(text).toContain('--parent-uid');
  });
});

describe('roam save: what follows a heading goes under it', () => {
  let fileCount = 0;

  /** Save `markdown` from a file, which is how multi-line content reaches `save`. */
  function saveMarkdown(markdown: string, ...flags: string[]): Run {
    const file = join(scratch, `nesting-${fileCount++}.md`);
    writeFileSync(file, markdown);
    return save(file, ...flags);
  }

  /** The one block this run created with this text. */
  function created(run: Run, text: string): Write {
    const found = run.blocks.filter((b) => b.block?.string === text);
    expect(found, `blocks with text "${text}"`).toHaveLength(1);
    return found[0];
  }

  const parentOf = (run: Run, text: string) => created(run, text).location?.['parent-uid'];
  const uidOf = (run: Run, text: string) => created(run, text).block?.uid;

  // roam_import_markdown has always nested whatever follows a heading under
  // it. `save` had a narrower rule of its own, which only applied when nothing
  // in the file was indented: one indented line anywhere and every heading was
  // left with nothing under it.
  const headingThenBullets = '# Title\n- Point one\n  - Detail\n- Point two';

  it('nests indented bullets under the heading above them', () => {
    const run = saveMarkdown(headingThenBullets, '--page', 'Test Page');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(created(run, 'Title').block?.heading).toBe(1);
    expect(parentOf(run, 'Title')).toBe('page00001');
    expect(parentOf(run, 'Point one')).toBe(uidOf(run, 'Title'));
    expect(parentOf(run, 'Detail')).toBe(uidOf(run, 'Point one'));
    expect(parentOf(run, 'Point two')).toBe(uidOf(run, 'Title'));
  });

  it('does the same when the file becomes a new page', () => {
    const run = saveMarkdown(headingThenBullets, '--title', 'Save Nesting Page');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(parentOf(run, 'Point one')).toBe(uidOf(run, 'Title'));
    expect(parentOf(run, 'Detail')).toBe(uidOf(run, 'Point one'));
    expect(parentOf(run, 'Point two')).toBe(uidOf(run, 'Title'));
  });

  it('nests under a heading that sits inside indented structure', () => {
    const run = saveMarkdown('- Group\n  - ## Inner heading\n  - Inner line', '--page', 'Test Page');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(parentOf(run, 'Group')).toBe('page00001');
    expect(parentOf(run, 'Inner heading')).toBe(uidOf(run, 'Group'));
    expect(parentOf(run, 'Inner line')).toBe(uidOf(run, 'Inner heading'));
  });

  it('still nests flush-left paragraphs and deeper headings under their headings', () => {
    const run = saveMarkdown(
      '## Section A\nPara under A\n### Sub A1\nPara under A1\n## Section B\nPara under B',
      '--page', 'Test Page',
    );

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(parentOf(run, 'Section A')).toBe('page00001');
    expect(parentOf(run, 'Para under A')).toBe(uidOf(run, 'Section A'));
    expect(parentOf(run, 'Sub A1')).toBe(uidOf(run, 'Section A'));
    expect(parentOf(run, 'Para under A1')).toBe(uidOf(run, 'Sub A1'));
    expect(parentOf(run, 'Section B')).toBe('page00001');
    expect(parentOf(run, 'Para under B')).toBe(uidOf(run, 'Section B'));
  });

  it('leaves what comes before the first heading at the top', () => {
    const run = saveMarkdown('Intro line\n# Title\nBody line', '--page', 'Test Page');

    expect(run.code).toBe(0);
    expect(parentOf(run, 'Intro line')).toBe('page00001');
    expect(parentOf(run, 'Title')).toBe('page00001');
    expect(parentOf(run, 'Body line')).toBe(uidOf(run, 'Title'));
  });

  it('--flatten keeps every block where its indentation puts it', () => {
    const run = saveMarkdown(headingThenBullets, '--page', 'Test Page', '--flatten');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(parentOf(run, 'Title')).toBe('page00001');
    expect(parentOf(run, 'Point one')).toBe('page00001');
    expect(parentOf(run, 'Detail')).toBe(uidOf(run, 'Point one'));
    expect(parentOf(run, 'Point two')).toBe('page00001');
  });
});

describe('roam save --update --nest', () => {
  // A save without --update puts what follows a heading under it. --update
  // takes the file as written, because it also has to write back a page that
  // was read, and such a page may keep blocks beside a heading on purpose. So
  // a file with its headings at the left margin, saved and then updated, had
  // every block moved out from under its heading. --nest asks the update to
  // read the file the way the first save did.
  //
  // Fixture: "Top Heading Fixture" has "Paragraph under control section one"
  // nested under the heading "Control section one".
  const flushLeft = '## Control section one\nParagraph under control section one\n## Control section two';
  let fileCount = 0;

  function update(...flags: string[]): Run {
    const file = join(scratch, `nest-${fileCount++}.md`);
    writeFileSync(file, flushLeft);
    return save(file, '--title', 'Top Heading Fixture', '--update', ...flags);
  }

  it('without --nest, moves the paragraph out from under its heading', () => {
    const run = update();

    expect(run.code).toBe(0);
    expect(run.moves.map((w) => w.block?.uid)).toContain('hdtoppar1');
  });

  it('with --nest, leaves the page as it is', () => {
    const run = update('--nest');

    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.moves).toEqual([]);
    expect(run.blocks).toEqual([]);
  });

  it('refuses --nest without --update, where it would mean nothing', () => {
    const file = join(scratch, `nest-${fileCount++}.md`);
    writeFileSync(file, flushLeft);
    const run = save(file, '--page', 'Test Page', '--nest');

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('--nest');
    expect(run.blocks).toEqual([]);
  });
});
