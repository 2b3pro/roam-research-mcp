import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpHarness } from './testing/mcp-harness.js';

/**
 * Titles, block text and search terms containing `"` or `\` at the wire (#23).
 *
 * Through 5.0.1 these values were interpolated into Datalog string literals
 * unescaped. A `"` ends the literal early and Roam answers
 * IndexOutOfBoundsException; on a real graph, 83 pages with a quoted title
 * could not be fetched by title. A `\` is read as an escape, so `C:\newdir`
 * comes back as a newline and the lookup silently finds nothing.
 *
 * The fake backend reads string literals as EDN and refuses a malformed query
 * with the same 500 Roam sends, so these fail against unescaped queries the
 * way the live graph did.
 */

const harness = new McpHarness({
  preload: './tests/fake-roam-backend.mjs',
  env: {
    ROAM_API_TOKEN: 'fake-token-for-tests',
    ROAM_GRAPH_NAME: 'fake-graph',
  },
});

beforeAll(() => harness.start(), 20000);
afterAll(() => harness.stop());

const fetchPage = async (title: string) => {
  const result = await harness.call('roam_fetch_page_by_title', { title, format: 'markdown' });
  return { isError: result.isError, text: McpHarness.text(result) };
};

describe('page lookup by a title the query has to escape', () => {
  it('fetches a page whose title contains double quotes', async () => {
    const { isError, text } = await fetchPage('Alex "Sandy" Pentland');
    expect(text).not.toContain('IndexOutOfBounds');
    expect(isError).toBeFalsy();
    expect(text).toContain('Said "never again" and meant it');
  });

  it('fetches a page whose title contains a backslash', async () => {
    const { isError, text } = await fetchPage('C:\\newdir Notes');
    expect(isError).toBeFalsy();
    expect(text).toContain('Notes kept under a Windows path');
  });

  it('reports a missing quoted page as not found, not as a query error', async () => {
    const result = await harness.call('roam_search_by_status', {
      status: 'TODO',
      page_title_uid: 'No "Such" Page',
    });
    const text = McpHarness.text(result);
    expect(result.isError).toBe(true);
    expect(text).toContain('not found');
    expect(text).not.toContain('IndexOutOfBounds');
  });
});

describe('search terms the query has to escape', () => {
  it('finds block text containing double quotes', async () => {
    const result = await harness.call('roam_search_by_text', { text: '"never again"' });
    const text = McpHarness.text(result);
    expect(text).not.toContain('IndexOutOfBounds');
    const { matches } = JSON.parse(text);
    expect(matches.map((m: { block_uid: string }) => m.block_uid)).toEqual(['quoteBlk1']);
  });
});

describe('roam_create_outline with values the query has to escape', () => {
  it('reports a created block whose text contains double quotes', async () => {
    // The post-write lookup matches the block by its exact string. Unescaped,
    // it errored, the error was swallowed, and created_blocks came back empty.
    const result = await harness.call('roam_create_outline', {
      page_title_uid: 'Alex "Sandy" Pentland',
      outline: [{ text: 'He called it "honest signals"', level: 1 }],
    });
    expect(result.isError).toBeFalsy();
    const { created_blocks } = JSON.parse(McpHarness.text(result));
    expect(created_blocks.map((b: { text: string }) => b.text)).toEqual([
      'He called it "honest signals"',
    ]);
  });

  it('creates a page whose title contains double quotes', async () => {
    const result = await harness.call('roam_create_outline', {
      page_title_uid: 'Book: "Dune"',
      outline: [{ text: 'First note', level: 1 }],
    });
    const text = McpHarness.text(result);
    expect(text).not.toContain('IndexOutOfBounds');
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text).page_uid).toMatch(/^\S{9}$/);
  });
});
