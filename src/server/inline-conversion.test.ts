import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * What reaches Roam when written text holds an asterisk, underscore or double
 * equals that is not markup.
 *
 * The write tools turn Markdown emphasis and highlights into Roam's. The
 * conversion paired any two markers on a line, so "2 * 3 * 4" was stored as
 * "2 __ 3 __ 4" and "if a == b and c == d" as "if a ^^ b and c ^^ d": the
 * text in the graph was not the text that was sent. The rules themselves are
 * unit-tested in src/markdown-utils.test.ts; this proves the tools' output.
 *
 * Fixture (tests/fake-roam-backend.mjs): page "Test Page" (page00001).
 */

const scratch = mkdtempSync(join(tmpdir(), 'roam-inline-conversion-test-'));
const writeLog = join(scratch, 'writes.jsonl');

const harness = new McpHarness({
  preload: './tests/fake-roam-backend.mjs',
  env: {
    ROAM_API_TOKEN: 'fake-token-for-tests',
    ROAM_GRAPH_NAME: 'fake-graph',
    FAKE_ROAM_WRITE_LOG: writeLog,
  },
});

beforeAll(() => harness.start(), 20000);
afterAll(async () => {
  await harness.stop();
  rmSync(scratch, { recursive: true, force: true });
});

vi.setConfig({ testTimeout: 30000 });

/** The text of every block the server has created so far. */
const createdTexts = (): string[] =>
  (existsSync(writeLog)
    ? readFileSync(writeLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []
  )
    .flatMap((body) => (body.action === 'batch-actions' ? body.actions : [body]))
    .filter((action) => action.action === 'create-block')
    .map((action) => action.block.string as string);

describe('text that only looks like markup is stored as sent', () => {
  it('roam_import_markdown keeps arithmetic, comparisons and star bullets intact', async () => {
    const before = createdTexts().length;
    const result = await harness.call('roam_import_markdown', {
      page_title: 'Test Page',
      content: [
        '- Area: 2 * 3 * 4',
        '- Guard: if a == b and c == d',
        '- Blank: a _ b _ c',
        '* star bullet with *emphasis*',
        '- A real *emphasis* and a real ==highlight==',
      ].join('\n'),
    });

    expect(result.isError, McpHarness.text(result)).not.toBe(true);
    expect(createdTexts().slice(before)).toEqual([
      'Area: 2 * 3 * 4',
      'Guard: if a == b and c == d',
      'Blank: a _ b _ c',
      'star bullet with __emphasis__',
      'A real __emphasis__ and a real ^^highlight^^',
    ]);
  });

  it('roam_create_outline keeps the same text intact in an item', async () => {
    const before = createdTexts().length;
    const result = await harness.call('roam_create_outline', {
      page_title_uid: 'Test Page',
      outline: [
        { text: 'Outline area: 2 * 3 * 4', level: 1 },
        { text: 'Outline guard: if a == b and c == d', level: 2 },
        { text: 'Outline *emphasis* stays emphasis', level: 2 },
      ],
    });

    expect(result.isError, McpHarness.text(result)).not.toBe(true);
    expect(createdTexts().slice(before)).toEqual([
      'Outline area: 2 * 3 * 4',
      'Outline guard: if a == b and c == d',
      'Outline __emphasis__ stays emphasis',
    ]);
  });
});
