import { describe, it, expect } from 'vitest';
import { resolveUpdateContent, applyStatus, clearStatus } from './update.js';

/**
 * Regression: `roam update <uid> --done` (and --todo / --clear-status) invoked as a
 * subprocess used to ERASE the block text, replacing it with a bare "{{[[DONE]]}} ".
 *
 * Cause: a subprocess has stdin = /dev/null, which is non-TTY but empty. The old
 * code read stdin and stored the empty string as the new content. Because '' !== undefined,
 * the "fetch existing block text" path was skipped, and applyStatus prepended the
 * marker to an empty string. The fix maps empty stdin to `undefined`.
 */
describe('resolveUpdateContent — empty stdin must not become content', () => {
  it('maps empty stdin (subprocess /dev/null) to undefined, not ""', async () => {
    const result = await resolveUpdateContent(undefined, async () => '', false);
    expect(result).toBeUndefined(); // undefined => caller fetches existing text; '' would erase the block
  });

  it('treats whitespace-only stdin as no content', async () => {
    const result = await resolveUpdateContent(undefined, async () => '  \n\t ', false);
    expect(result).toBeUndefined();
  });

  it('uses real piped stdin content when present', async () => {
    const result = await resolveUpdateContent(undefined, async () => 'piped text', false);
    expect(result).toBe('piped text');
  });

  it('prefers an explicit content argument over stdin', async () => {
    const result = await resolveUpdateContent('explicit', async () => 'piped', false);
    expect(result).toBe('explicit');
  });

  it('does not read stdin from an interactive TTY when no content arg given', async () => {
    let read = false;
    const result = await resolveUpdateContent(undefined, async () => { read = true; return 'x'; }, true);
    expect(result).toBeUndefined();
    expect(read).toBe(false);
  });

  it('reads stdin when content arg is the explicit "-" sentinel, even on a TTY', async () => {
    const result = await resolveUpdateContent('-', async () => 'from dash', true);
    expect(result).toBe('from dash');
  });

  it('explicit "-" with empty stdin still resolves to undefined (does not erase)', async () => {
    const result = await resolveUpdateContent('-', async () => '', true);
    expect(result).toBeUndefined();
  });
});

describe('applyStatus — find-replace preserves block text', () => {
  it('converts an existing {{[[TODO]]}} marker to DONE in place, keeping text', () => {
    expect(applyStatus('{{[[TODO]]}} Buy milk', 'DONE')).toBe('{{[[DONE]]}} Buy milk');
  });

  it('supports the {{TODO}} (non-page-ref) marker form', () => {
    expect(applyStatus('{{TODO}} Buy milk', 'DONE')).toBe('{{[[DONE]]}} Buy milk');
  });

  it('prepends DONE when no marker is present, keeping the text', () => {
    expect(applyStatus('Buy milk', 'DONE')).toBe('{{[[DONE]]}} Buy milk');
  });

  it('is a no-op when the target status is already present', () => {
    expect(applyStatus('{{[[DONE]]}} Buy milk', 'DONE')).toBe('{{[[DONE]]}} Buy milk');
  });

  it('converts DONE back to TODO in place', () => {
    expect(applyStatus('{{[[DONE]]}} Buy milk', 'TODO')).toBe('{{[[TODO]]}} Buy milk');
  });

  it('documents the failure mode: empty content + DONE yields a bare marker — which is exactly why resolveUpdateContent must not pass ""', () => {
    expect(applyStatus('', 'DONE')).toBe('{{[[DONE]]}} ');
  });
});

describe('clearStatus', () => {
  it('removes a TODO/DONE marker and trims, keeping the text', () => {
    expect(clearStatus('{{[[DONE]]}} Buy milk')).toBe('Buy milk');
    expect(clearStatus('{{TODO}} Buy milk')).toBe('Buy milk');
  });
});
