import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * Roam's `update-page` reads two things, both from inside `page`: the UID that
 * says which page, and the new title. From v2.3.0 through v6.1.0 this server
 * sent the new title beside `page` instead. Roam ignores a key it does not
 * read, so a rename by UID changed nothing and reported success, and a rename
 * by title was refused for having no UID (issue #32). Both were confirmed
 * against a live graph on 2026-11-20, as was the request these tests expect:
 * it renamed the page, by UID and by title.
 *
 * The fake backend applies a rename only when the request is shaped the way
 * Roam reads it, so these tests look at the graph afterwards rather than at
 * what the tool said about itself.
 */

const scratch = mkdtempSync(join(tmpdir(), 'roam-rename-test-'));
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

/** Every write the server has sent to Roam so far. */
const writes = (): unknown[] =>
  existsSync(writeLog)
    ? readFileSync(writeLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];

const rename = (args: Record<string, unknown>) => harness.call('roam_rename_page', args);

const readPage = async (title: string) => {
  const result = await harness.call('roam_fetch_page_by_title', { title });
  return { isError: result.isError === true, text: McpHarness.text(result) };
};

describe('roam_rename_page', () => {
  it('renames a page identified by UID', async () => {
    const result = await rename({ uid: 'renamePg1', new_title: 'Renamed By Uid' });

    expect(JSON.parse(McpHarness.text(result))).toMatchObject({ success: true });
    expect(writes()).toContainEqual({
      action: 'update-page',
      page: { uid: 'renamePg1', title: 'Renamed By Uid' },
    });

    const renamed = await readPage('Renamed By Uid');
    expect(renamed.isError).toBe(false);
    expect(renamed.text).toContain('Lives on the page renamed by UID');
    expect((await readPage('Rename By Uid')).isError).toBe(true);
  });

  it('renames a page identified by its current title', async () => {
    const result = await rename({ old_title: 'Rename By Title', new_title: 'Renamed By Title' });

    expect(JSON.parse(McpHarness.text(result))).toMatchObject({ success: true });
    expect(writes()).toContainEqual({
      action: 'update-page',
      page: { uid: 'renamePg2', title: 'Renamed By Title' },
    });

    const renamed = await readPage('Renamed By Title');
    expect(renamed.isError).toBe(false);
    expect(renamed.text).toContain('Lives on the page renamed by title');
    expect((await readPage('Rename By Title')).isError).toBe(true);
  });

  it('renames by title when uid is sent as an empty string', async () => {
    // A client that fills in every parameter sends `uid: ""` beside the title.
    const result = await rename({
      uid: '',
      old_title: 'Rename With Blank Uid',
      new_title: 'Renamed With Blank Uid',
    });

    expect(JSON.parse(McpHarness.text(result))).toMatchObject({ success: true });
    expect(writes()).toContainEqual({
      action: 'update-page',
      page: { uid: 'renamePg3', title: 'Renamed With Blank Uid' },
    });
  });
});

describe('roam_rename_page with nothing to rename', () => {
  it('reports PAGE_NOT_FOUND for a title no page has, and writes nothing', async () => {
    const before = writes().length;
    const result = await rename({ old_title: 'No Such Page', new_title: 'Anything' });

    expect(result.isError).toBe(true);
    const { error } = JSON.parse(McpHarness.text(result));
    expect(error.code).toBe('PAGE_NOT_FOUND');
    expect(error.message).toContain('No Such Page');
    expect(writes()).toHaveLength(before);
  });

  it('matches the title exactly, so a differently cased title is not found', async () => {
    // Roam titles are case-sensitive and "test page" can exist beside
    // "Test Page". Renaming whichever one a loose match found would rename a
    // page the caller did not name.
    const before = writes().length;
    const result = await rename({ old_title: 'test page', new_title: 'Anything' });

    expect(result.isError).toBe(true);
    expect(JSON.parse(McpHarness.text(result)).error.code).toBe('PAGE_NOT_FOUND');
    expect(writes()).toHaveLength(before);
    expect((await readPage('Test Page')).isError).toBe(false);
  });

  it.each([
    ['a UID nothing has', 'missing01'],
    ['the UID of a block', 'vis000001'],
  ])('reports PAGE_NOT_FOUND for %s, and writes nothing', async (_label, uid) => {
    const before = writes().length;
    const result = await rename({ uid, new_title: 'Anything' });

    expect(result.isError).toBe(true);
    const { error } = JSON.parse(McpHarness.text(result));
    expect(error.code).toBe('PAGE_NOT_FOUND');
    expect(error.message).toContain(uid);
    expect(writes()).toHaveLength(before);
  });
});
