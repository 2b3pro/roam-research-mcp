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
