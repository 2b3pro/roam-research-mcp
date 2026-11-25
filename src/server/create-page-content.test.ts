import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * `roam_create_page` at the wire: what a `## ` at the start of an item's text
 * becomes.
 *
 * The tool removed the hashes and set no heading, so "## Overview" arrived as
 * a plain block reading "Overview" unless the item also passed `heading`.
 * `roam_create_outline`, `roam_process_batch_actions`, `roam batch` and
 * `roam save` all read the same text as a level-2 heading.
 *
 * Fixture (tests/fake-roam-backend.mjs): no page with these titles exists, so
 * each test creates its own.
 */

const scratch = mkdtempSync(join(tmpdir(), 'roam-create-page-test-'));
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

interface Created {
  block: { uid?: string; string: string; heading?: number };
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

async function createPage(title: string, content: Record<string, unknown>[]): Promise<void> {
  const result = await harness.call('roam_create_page', { title, content });
  expect(result.isError, McpHarness.text(result)).not.toBe(true);
}

describe('roam_create_page: a heading written as hashes in the text', () => {
  it.each([
    ['#', 1],
    ['##', 2],
    ['###', 3],
  ])('reads "%s " as a level-%i heading and removes the hashes', async (hashes, level) => {
    const text = `p1 heading ${level}`;
    await createPage(`Create Page Hashes ${level}`, [
      { text: `${hashes} ${text}`, level: 1 },
      { text: `p1 body ${level}`, level: 2 },
    ]);

    expect(block(text).heading).toBe(level);
    expect(block(`p1 body ${level}`).heading).toBeUndefined();
  });

  it('lets an explicit `heading` decide when the text has hashes too', async () => {
    await createPage('Create Page Explicit Heading', [
      { text: '## p2 hashes say two', level: 1, heading: 3 },
      { text: 'p2 heading only', level: 1, heading: 1 },
    ]);

    expect(block('p2 hashes say two').heading).toBe(3);
    expect(block('p2 heading only').heading).toBe(1);
  });

  it('gives no heading to four or more hashes, which Roam has no level for', async () => {
    await createPage('Create Page Four Hashes', [{ text: '#### p3 deep', level: 1 }]);

    expect(block('p3 deep').heading).toBeUndefined();
  });

  it('leaves a tag at the start of the text alone', async () => {
    await createPage('Create Page Leading Tag', [{ text: '#p4tag first word', level: 1 }]);

    expect(block('#p4tag first word').heading).toBeUndefined();
  });
});
