import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * `roam_create_outline` at the wire: which block gets an item's `heading` and
 * `children_view_type`.
 *
 * The tool writes the outline out as indented text, parses that, and copies
 * each item's `heading` and `children_view_type` onto the parsed blocks. It
 * copied them by position onto the TOP-LEVEL blocks only: top-level block N
 * got the settings of item N in the flat list. So in any outline with nesting
 * a child's heading landed on a later top-level block, the child got none, and
 * a nested `children_view_type` was dropped. A flat outline hid it.
 *
 * Every test uses its own block texts: the tests share one server and one
 * write log, and a block is found by its text.
 *
 * Fixture (tests/fake-roam-backend.mjs): page "Test Page" (page00001).
 */

const scratch = mkdtempSync(join(tmpdir(), 'roam-create-outline-test-'));
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

// The tool looks each top-level block up again after writing, with a pause
// between tries, and the fixture does not read back what was written.
vi.setConfig({ testTimeout: 30000 });

interface Created {
  location: { 'parent-uid': string };
  block: { uid: string; string: string; heading?: number; 'children-view-type'?: string };
}

/** Every create-block the server has sent to Roam so far. */
const createdBlocks = (): Created[] =>
  (existsSync(writeLog)
    ? readFileSync(writeLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []
  )
    .flatMap((body) => (body.action === 'batch-actions' ? body.actions : [body]))
    .filter((action) => action.action === 'create-block');

/** The one created block with this text. */
function block(text: string): Created['block'] {
  const found = createdBlocks().filter((action) => action.block.string === text);
  expect(found, `created blocks with text ${JSON.stringify(text)}`).toHaveLength(1);
  return found[0].block;
}

async function createOutline(outline: Record<string, unknown>[]): Promise<void> {
  const result = await harness.call('roam_create_outline', { outline, page_title_uid: 'Test Page' });
  expect(result.isError, McpHarness.text(result)).not.toBe(true);
}

describe('roam_create_outline: heading and children_view_type', () => {
  it('puts each on the item that asked for it, at any depth', async () => {
    await createOutline([
      { text: 'n1 top', level: 1 },
      { text: 'n1 child heading', level: 2, heading: 3 },
      { text: 'n1 steps', level: 2, children_view_type: 'numbered' },
      { text: 'n1 step one', level: 3 },
      { text: 'n1 second top', level: 1, heading: 2 },
      { text: 'n1 plain child', level: 2 },
    ]);

    expect(block('n1 child heading').heading).toBe(3);
    expect(block('n1 steps')['children-view-type']).toBe('numbered');
    expect(block('n1 second top').heading).toBe(2);

    for (const text of ['n1 top', 'n1 steps', 'n1 step one', 'n1 plain child']) {
      expect(block(text).heading, `heading of "${text}"`).toBeUndefined();
    }
    for (const text of ['n1 top', 'n1 child heading', 'n1 step one', 'n1 second top', 'n1 plain child']) {
      expect(block(text)['children-view-type'], `view type of "${text}"`).toBeUndefined();
    }
  });

  it('lines items up with their blocks past a code block item', async () => {
    await createOutline([
      { text: 'n2 top', level: 1 },
      { text: '```js\nconst n2 = 1;\n```', level: 2 },
      { text: 'n2 after the code', level: 1, heading: 2 },
    ]);

    expect(block('n2 after the code').heading).toBe(2);
    expect(block('```js\nconst n2 = 1;\n```').heading).toBeUndefined();
    expect(block('n2 top').heading).toBeUndefined();
  });

  it('gives a heading to the first line of an item whose text spans two lines', async () => {
    // Such an item becomes two blocks. The settings belong to the first, and
    // the items after it still have to line up.
    await createOutline([
      { text: 'n3 top', level: 1 },
      { text: 'n3 line one\nn3 line two', level: 2, heading: 3 },
      { text: 'n3 after', level: 1, heading: 2 },
    ]);

    expect(block('n3 line one').heading).toBe(3);
    expect(block('n3 line two').heading).toBeUndefined();
    expect(block('n3 after').heading).toBe(2);
    expect(block('n3 top').heading).toBeUndefined();
  });

  it('still reads a heading written as hashes in the text, and lets `heading` override it', async () => {
    await createOutline([
      { text: '## n4 hashes only', level: 1 },
      { text: '## n4 hashes and heading', level: 2, heading: 3 },
    ]);

    expect(block('n4 hashes only').heading).toBe(2);
    expect(block('n4 hashes and heading').heading).toBe(3);
  });

  it('leaves a flat outline as it was', async () => {
    await createOutline([
      { text: 'n5 a', level: 1, heading: 1 },
      { text: 'n5 b', level: 1 },
      { text: 'n5 c', level: 1, heading: 3 },
    ]);

    expect(block('n5 a').heading).toBe(1);
    expect(block('n5 b').heading).toBeUndefined();
    expect(block('n5 c').heading).toBe(3);
  });
});
