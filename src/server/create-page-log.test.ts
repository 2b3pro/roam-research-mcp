import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpHarness } from './testing/mcp-harness.js';
import { formatRoamDate } from '../utils/helpers.js';

/**
 * `roam_create_page` at the wire: the lines it writes to log a page creation.
 *
 * By default a new page is made by writing "Created page: [[Title]]" to today's
 * daily page, and "Processed: [[today]]" goes on the page. When the page being
 * created was today's daily page, both lines landed on that page and pointed
 * only at itself (issue #52). `log: false` creates a page with neither line.
 *
 * Fixture (tests/fake-roam-backend.mjs): today's daily page does not exist
 * until something creates it. This file has its own server, and the daily-page
 * test runs first, so it starts from a day with no daily page.
 */

const scratch = mkdtempSync(join(tmpdir(), 'roam-create-page-log-test-'));
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

const today = formatRoamDate(new Date());

/** Every write body since the given count of earlier writes. */
function writesSince(start: number): any[] {
  return existsSync(writeLog)
    ? readFileSync(writeLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).slice(start)
    : [];
}

const writeCount = () => writesSince(0).length;

const blockTexts = (writes: any[]): string[] =>
  writes
    .flatMap((body) => (body.action === 'batch-actions' ? body.actions : [body]))
    .filter((action) => action.action === 'create-block')
    .map((action) => action.block.string);

const createdPages = (writes: any[]): string[] =>
  writes.filter((body) => body.action === 'create-page').map((body) => body.page.title);

async function createPage(args: Record<string, unknown>): Promise<any[]> {
  const start = writeCount();
  const result = await harness.call('roam_create_page', args);
  expect(result.isError, McpHarness.text(result)).not.toBe(true);
  return writesSince(start);
}

describe('roam_create_page: page creation log lines', () => {
  it('writes no log lines when the new page is today\'s daily page (#52)', async () => {
    const writes = await createPage({ title: today, content: [{ text: 'daily block', level: 1 }] });

    expect(createdPages(writes)).toEqual([today]);
    expect(blockTexts(writes)).toEqual(['daily block']);
  });

  it('logs the creation of any other page by default', async () => {
    const writes = await createPage({ title: 'Log Default Page' });

    expect(blockTexts(writes)).toEqual(['Created page: [[Log Default Page]]', `Processed: [[${today}]]`]);
  });

  it('creates the page with neither line when log is false', async () => {
    const writes = await createPage({
      title: 'Log Off Page',
      content: [{ text: 'quiet block', level: 1 }],
      log: false,
    });

    expect(createdPages(writes)).toEqual(['Log Off Page']);
    expect(blockTexts(writes)).toEqual(['quiet block']);
  });
});
