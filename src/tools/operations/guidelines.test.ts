import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Graph } from '@roam-research/roam-api-sdk';

const getPageUid = vi.fn();
const fetchPageByTitle = vi.fn();

vi.mock('./pages.js', () => ({
  PageOperations: vi.fn().mockImplementation(() => ({ getPageUid, fetchPageByTitle })),
}));

import { GuidelinesOperations, DEFAULT_GUIDELINES_PAGE } from './guidelines.js';

/** A fresh Graph object per test — the cache is keyed by graph identity. */
const newGraph = () => ({}) as Graph;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GuidelinesOperations', () => {
  it('returns the page content when the page exists', async () => {
    getPageUid.mockResolvedValue('abc123456');
    fetchPageByTitle.mockResolvedValue('- H2: Tagging Philosophy');

    const res = await new GuidelinesOperations(newGraph()).getGuidelines();

    expect(res.exists).toBe(true);
    expect(res.page).toBe(DEFAULT_GUIDELINES_PAGE);
    expect(res.guidelines).toBe('- H2: Tagging Philosophy');
    expect(fetchPageByTitle).toHaveBeenCalledWith(DEFAULT_GUIDELINES_PAGE, 'markdown');
  });

  it('reports absence rather than failing when no page has been created', async () => {
    getPageUid.mockResolvedValue(null);

    const res = await new GuidelinesOperations(newGraph()).getGuidelines();

    expect(res.exists).toBe(false);
    expect(res.guidelines).toBeNull();
    expect(res.nextSteps).toMatch(/no user conventions/i);
    expect(fetchPageByTitle).not.toHaveBeenCalled();
  });

  it('honours a per-graph page title', async () => {
    getPageUid.mockResolvedValue('abc123456');
    fetchPageByTitle.mockResolvedValue('work rules');

    const res = await new GuidelinesOperations(newGraph(), 'work/agent rules').getGuidelines();

    expect(res.page).toBe('work/agent rules');
    expect(getPageUid).toHaveBeenCalledWith('work/agent rules');
  });

  it('reports guidelines as disabled without touching the graph', async () => {
    const res = await new GuidelinesOperations(newGraph(), null).getGuidelines();

    expect(res.page).toBeNull();
    expect(res.exists).toBe(false);
    expect(res.nextSteps).toMatch(/disabled/i);
    expect(getPageUid).not.toHaveBeenCalled();
  });

  it('fails open — a lookup error never breaks the tool the agent wanted', async () => {
    getPageUid.mockRejectedValue(new Error('network down'));

    const res = await new GuidelinesOperations(newGraph()).getGuidelines();

    expect(res.exists).toBe(false);
    expect(res.guidelines).toBeNull();
    expect(res.nextSteps).toMatch(/network down/);
  });

  it('always reports today in Roam ordinal date format', async () => {
    getPageUid.mockResolvedValue(null);
    const res = await new GuidelinesOperations(newGraph()).getGuidelines();
    expect(res.todaysDailyNote).toMatch(/^[A-Z][a-z]+ \d{1,2}(st|nd|rd|th), \d{4}$/);
  });

  it('tells the agent not to re-orient, so it does not refetch every call', async () => {
    getPageUid.mockResolvedValue('abc123456');
    fetchPageByTitle.mockResolvedValue('rules');
    const res = await new GuidelinesOperations(newGraph()).getGuidelines();
    expect(res.nextSteps).toMatch(/do not call this tool again/i);
    expect(res.nextSteps).toMatch(/reads as well as writes/i);
  });

  it('caches within the TTL so a burst of calls costs one fetch', async () => {
    getPageUid.mockResolvedValue('abc123456');
    fetchPageByTitle.mockResolvedValue('rules');

    const ops = new GuidelinesOperations(newGraph());
    await ops.getGuidelines();
    await ops.getGuidelines();
    await ops.getGuidelines();

    expect(getPageUid).toHaveBeenCalledTimes(1);
  });

  it('refetches after the cache is cleared', async () => {
    getPageUid.mockResolvedValue('abc123456');
    fetchPageByTitle.mockResolvedValue('rules');

    const ops = new GuidelinesOperations(newGraph());
    await ops.getGuidelines();
    ops.clearCache();
    await ops.getGuidelines();

    expect(getPageUid).toHaveBeenCalledTimes(2);
  });

  it('keeps separate graphs separate', async () => {
    getPageUid.mockResolvedValue('abc123456');
    fetchPageByTitle.mockResolvedValue('rules');

    await new GuidelinesOperations(newGraph()).getGuidelines();
    await new GuidelinesOperations(newGraph()).getGuidelines();

    expect(getPageUid).toHaveBeenCalledTimes(2);
  });
});
