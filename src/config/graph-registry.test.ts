import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphRegistry } from './graph-registry.js';

describe('GraphRegistry', () => {
  describe('getMemoriesTag', () => {
    const originalEnv = process.env.ROAM_MEMORIES_TAG;

    afterEach(() => {
      // Restore original env
      if (originalEnv !== undefined) {
        process.env.ROAM_MEMORIES_TAG = originalEnv;
      } else {
        delete process.env.ROAM_MEMORIES_TAG;
      }
    });

    it('returns per-graph memoriesTag when configured', () => {
      const registry = new GraphRegistry(
        {
          personal: { token: 't1', graph: 'g1', memoriesTag: '#PersonalMemories' },
          system: { token: 't2', graph: 'g2', memoriesTag: '#[[PAI/Memories]]' },
        },
        'personal'
      );
      expect(registry.getMemoriesTag('personal')).toBe('#PersonalMemories');
      expect(registry.getMemoriesTag('system')).toBe('#[[PAI/Memories]]');
    });

    it('falls back to ROAM_MEMORIES_TAG env var when not configured per-graph', () => {
      process.env.ROAM_MEMORIES_TAG = '#EnvMemories';
      const registry = new GraphRegistry(
        { default: { token: 't', graph: 'g' } },
        'default'
      );
      expect(registry.getMemoriesTag()).toBe('#EnvMemories');
    });

    it('falls back to "Memories" when neither per-graph nor env configured', () => {
      delete process.env.ROAM_MEMORIES_TAG;
      const registry = new GraphRegistry(
        { default: { token: 't', graph: 'g' } },
        'default'
      );
      expect(registry.getMemoriesTag()).toBe('Memories');
    });

    it('uses default graph when key not specified', () => {
      const registry = new GraphRegistry(
        {
          personal: { token: 't1', graph: 'g1', memoriesTag: '#Personal' },
          work: { token: 't2', graph: 'g2', memoriesTag: '#Work' },
        },
        'personal'
      );
      expect(registry.getMemoriesTag()).toBe('#Personal');
    });
  });

  describe('getGraphInfoMarkdown', () => {
    it('returns empty string for single-graph mode with default key', () => {
      const registry = new GraphRegistry(
        { default: { token: 'token', graph: 'graph' } },
        'default'
      );
      expect(registry.getGraphInfoMarkdown()).toBe('');
    });

    it('returns markdown table for multi-graph mode', () => {
      const registry = new GraphRegistry(
        {
          personal: { token: 'token1', graph: 'personal-graph' },
          work: { token: 'token2', graph: 'work-graph', protected: true },
        },
        'personal'
      );
      const markdown = registry.getGraphInfoMarkdown();

      expect(markdown).toContain('## Available Graphs');
      expect(markdown).toContain('| personal | ✓ | No |');
      expect(markdown).toContain('| work |  | Yes |');
      expect(markdown).toContain('> **Note:** Write operations to protected graphs');
    });

    it('shows write protection for default graph if configured', () => {
      const registry = new GraphRegistry(
        {
          main: { token: 'token1', graph: 'main-graph', protected: true },
          backup: { token: 'token2', graph: 'backup-graph' },
        },
        'main'
      );
      const markdown = registry.getGraphInfoMarkdown();

      expect(markdown).toContain('| main | ✓ | Yes |');
      expect(markdown).toContain('| backup |  | No |');
    });
  });
});

describe('getGuidelinesPage', () => {
  const make = (configs: Record<string, any>, def = 'personal') =>
    new GraphRegistry(configs as any, def);

  it('defaults to the shared roam/agent guidelines convention', () => {
    delete process.env.ROAM_GUIDELINES_PAGE;
    const r = make({ personal: { token: 't', graph: 'g' } });
    expect(r.getGuidelinesPage('personal')).toBe('roam/agent guidelines');
  });

  it('prefers per-graph config over the env var', () => {
    process.env.ROAM_GUIDELINES_PAGE = 'env/page';
    const r = make({ work: { token: 't', graph: 'g', guidelinesPage: 'work/rules' } }, 'work');
    expect(r.getGuidelinesPage('work')).toBe('work/rules');
    delete process.env.ROAM_GUIDELINES_PAGE;
  });

  it('falls back to the env var when a graph sets nothing', () => {
    process.env.ROAM_GUIDELINES_PAGE = 'env/page';
    const r = make({ personal: { token: 't', graph: 'g' } });
    expect(r.getGuidelinesPage('personal')).toBe('env/page');
    delete process.env.ROAM_GUIDELINES_PAGE;
  });

  it('returns null when a graph disables guidelines', () => {
    const r = make({ personal: { token: 't', graph: 'g', guidelinesPage: false } });
    expect(r.getGuidelinesPage('personal')).toBeNull();
  });

  it('resolves the default graph when no key is given', () => {
    delete process.env.ROAM_GUIDELINES_PAGE;
    const r = make({ personal: { token: 't', graph: 'g', guidelinesPage: 'p/rules' } });
    expect(r.getGuidelinesPage()).toBe('p/rules');
  });
});

describe('write-key denial does not disclose the key', () => {
  /**
   * The write key is the whole gate on protected graphs. An error that tells
   * the caller what the key is hands the agent the means to retry and get
   * through — the protection becomes decorative.
   */
  const SECRET = 'super-secret-write-key';
  const original = process.env.ROAM_SYSTEM_WRITE_KEY;

  beforeEach(() => {
    process.env.ROAM_SYSTEM_WRITE_KEY = SECRET;
  });

  afterEach(() => {
    if (original !== undefined) process.env.ROAM_SYSTEM_WRITE_KEY = original;
    else delete process.env.ROAM_SYSTEM_WRITE_KEY;
  });

  // 'work' must be NON-default: writes to the default graph bypass protection
  // by design, so a protected default graph never reaches the denial path.
  const protectedRegistry = () =>
    new GraphRegistry(
      {
        personal: { token: 't', graph: 'p' },
        work: { token: 't', graph: 'g', protected: true },
      } as any,
      'personal'
    );

  it('never puts the key in the denial message', () => {
    let message = '';
    try {
      protectedRegistry().validateWriteAccess('roam_create_page', 'work', undefined);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, 'denial message must not be empty').not.toBe('');
    expect(message).not.toContain(SECRET);
  });

  it('never discloses the key when a wrong one is supplied', () => {
    let message = '';
    try {
      protectedRegistry().validateWriteAccess('roam_create_page', 'work', 'wrong-guess');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain(SECRET);
  });

  it('still explains what is required, so a legitimate caller can proceed', () => {
    let message = '';
    try {
      protectedRegistry().validateWriteAccess('roam_create_page', 'work', undefined);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/write_key/);
    expect(message).toMatch(/work/);
  });

  it('lets a correct key through', () => {
    expect(() =>
      protectedRegistry().validateWriteAccess('roam_create_page', 'work', SECRET)
    ).not.toThrow();
  });

  it('does not gate reads on protected graphs', () => {
    expect(() =>
      protectedRegistry().validateWriteAccess('roam_search_by_text', 'work', undefined)
    ).not.toThrow();
  });
});
