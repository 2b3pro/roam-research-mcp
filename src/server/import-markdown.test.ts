import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * `roam_import_markdown` at the wire: a heading given as the only line.
 *
 * Content of two or more lines goes through the markdown parser, which reads
 * "## Title" as a level-2 heading. Content of one line took a shortcut that
 * wrote it as typed, so the same "## Title" arrived as a plain block with the
 * hashes in its text. `roam save "## Title"` has always made it a heading.
 *
 * Fixture (tests/fake-roam-backend.mjs): page "Test Page" (page00001).
 */

const scratch = mkdtempSync(join(tmpdir(), 'roam-import-markdown-test-'));
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

// After writing one line the tool looks the block up again, with a pause
// between tries, and the fixture does not read back what was written.
vi.setConfig({ testTimeout: 30000 });

interface Created {
  location: { 'parent-uid': string };
  block: { string: string; heading?: number };
}

/** Every create-block the server has sent to Roam so far. */
const createdBlocks = (): Created[] =>
  (existsSync(writeLog)
    ? readFileSync(writeLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []
  )
    .flatMap((body) => (body.action === 'batch-actions' ? body.actions : [body]))
    .filter((action) => action.action === 'create-block');

/** Import `content` into Test Page and return the blocks that call created. */
async function importMarkdown(content: string): Promise<Created[]> {
  const before = createdBlocks().length;
  const result = await harness.call('roam_import_markdown', { content, page_title: 'Test Page' });
  expect(result.isError, McpHarness.text(result)).not.toBe(true);
  return createdBlocks().slice(before);
}

describe('roam_import_markdown: content that is one line', () => {
  it.each([
    ['#', 1],
    ['##', 2],
    ['###', 3],
  ])('reads "%s " as a level-%i heading, as it does in longer content', async (hashes, level) => {
    const created = await importMarkdown(`${hashes} Single line title ${level}`);

    expect(created).toHaveLength(1);
    expect(created[0].block.string).toBe(`Single line title ${level}`);
    expect(created[0].block.heading).toBe(level);
    expect(created[0].location['parent-uid']).toBe('page00001');
  });

  it('makes the same block from a heading alone as from that heading with a line under it', async () => {
    const [alone] = await importMarkdown('## Same either way');
    const [withBody] = await importMarkdown('## Same either way\nA line under it');

    expect(alone.block.string).toBe(withBody.block.string);
    expect(alone.block.heading).toBe(withBody.block.heading);
  });

  it.each([
    ['plain text', 'Just a sentence.'],
    ['four hashes, which Roam has no heading level for', '#### Too deep'],
    ['a tag first', '#tag and then words'],
  ])('writes %s as typed, with no heading', async (_label, content) => {
    const created = await importMarkdown(content);

    expect(created).toHaveLength(1);
    expect(created[0].block.string).toBe(content);
    expect(created[0].block.heading).toBeUndefined();
  });
});
