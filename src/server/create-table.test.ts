import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * `roam_create_table` at the wire: the blocks it sends and the UID it reports.
 *
 * `roam batch` builds its tables through the same builder (issue #40: it used
 * to have a layout of its own, and Roam showed the result on its side), so the
 * builder now takes the names a table's blocks are created under. This pins
 * what the MCP tool does with it: the layout the cheatsheet describes, and a
 * `table_uid` that is the table block's.
 *
 * Fixture (tests/fake-roam-backend.mjs): page "Test Page" (page00001).
 */

const scratch = mkdtempSync(join(tmpdir(), 'roam-create-table-test-'));
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

/** Every create-block the server has sent to Roam so far. */
const createdBlocks = (): any[] =>
  (existsSync(writeLog)
    ? readFileSync(writeLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []
  )
    .flatMap((body) => (body.action === 'batch-actions' ? body.actions : [body]))
    .filter((action) => action.action === 'create-block');

describe('roam_create_table', () => {
  it('builds the table row by row and reports the table block as table_uid', async () => {
    const result = await harness.call('roam_create_table', {
      parent_uid: 'page00001',
      headers: ['', 'H1', 'H2'],
      rows: [
        { label: 'R1', cells: ['a', 'b'] },
        { label: 'R2', cells: ['c', 'd'] },
      ],
    });

    const output = JSON.parse(McpHarness.text(result));
    expect(output).toMatchObject({ success: true });

    const blocks = createdBlocks();
    const uidOf = (text: string) => {
      const found = blocks.filter((action) => action.block.string === text);
      expect(found, `blocks with text "${text}"`).toHaveLength(1);
      return found[0].block.uid as string;
    };
    const under = (parentUid: string) =>
      blocks
        .filter((action) => action.location['parent-uid'] === parentUid)
        .sort((a, b) => a.location.order - b.location.order)
        .map((action) => action.block.string);

    const tableUid = uidOf('{{[[table]]}}');
    expect(output.table_uid).toBe(tableUid);
    expect(under('page00001')).toEqual(['{{[[table]]}}']);
    expect(under(tableUid)).toEqual([' ', 'R1', 'R2']);
    expect(under(uidOf(' '))).toEqual(['H1']);
    expect(under(uidOf('H1'))).toEqual(['H2']);
    expect(under(uidOf('R1'))).toEqual(['a']);
    expect(under(uidOf('a'))).toEqual(['b']);
    expect(under(uidOf('R2'))).toEqual(['c']);
    expect(under(uidOf('c'))).toEqual(['d']);
  });
});
