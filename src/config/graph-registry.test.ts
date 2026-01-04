import { describe, it, expect } from 'vitest';
import { GraphRegistry } from './graph-registry.js';

describe('GraphRegistry', () => {
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
          work: { token: 'token2', graph: 'work-graph', write_key: 'confirm' },
        },
        'personal'
      );
      const markdown = registry.getGraphInfoMarkdown();

      expect(markdown).toContain('## Available Graphs');
      expect(markdown).toContain('| personal | ✓ | No |');
      expect(markdown).toContain('| work |  | Yes (requires `write_key: "confirm"`) |');
      expect(markdown).toContain('> **Note:** Write operations to protected graphs');
    });

    it('shows write protection for default graph if configured', () => {
      const registry = new GraphRegistry(
        {
          main: { token: 'token1', graph: 'main-graph', write_key: 'secret' },
          backup: { token: 'token2', graph: 'backup-graph' },
        },
        'main'
      );
      const markdown = registry.getGraphInfoMarkdown();

      expect(markdown).toContain('| main | ✓ | Yes (requires `write_key: "secret"`) |');
      expect(markdown).toContain('| backup |  | No |');
    });
  });
});
