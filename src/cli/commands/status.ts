import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRegistry } from '../utils/graph.js';
import { q } from '@roam-research/roam-api-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json to get the version
const packageJsonPath = join(__dirname, '../../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

interface StatusOptions {
  ping?: boolean;
  json?: boolean;
}

interface GraphStatus {
  name: string;
  default: boolean;
  protected: boolean;
  writeKey?: string;
  connected?: boolean;
  error?: string;
}

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show available graphs and connection status')
    .option('--ping', 'Test connection to each graph')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  # Show available graphs
  roam status

  # Test connectivity to all graphs
  roam status --ping

  # JSON output for scripting
  roam status --json
`)
    .action(async (options: StatusOptions) => {
      try {
        const registry = getRegistry();
        const graphKeys = registry.getAvailableGraphs();

        const statuses: GraphStatus[] = [];

        for (const key of graphKeys) {
          const config = registry.getConfig(key)!;
          const isDefault = key === registry.defaultKey;
          const isProtected = !!config.write_key;

          const status: GraphStatus = {
            name: key,
            default: isDefault,
            protected: isProtected,
          };

          if (isProtected) {
            status.writeKey = config.write_key;
          }

          if (options.ping) {
            try {
              const graph = registry.getGraph(key);
              // Simple query to test connection - just find any entity
              await q(graph, '[:find ?e . :where [?e :db/id]]', []);
              status.connected = true;
            } catch (error) {
              status.connected = false;
              status.error = error instanceof Error ? error.message : String(error);
            }
          }

          statuses.push(status);
        }

        if (options.json) {
          console.log(JSON.stringify({
            version,
            graphs: statuses,
          }, null, 2));
          return;
        }

        // Pretty print
        console.log(`Roam Research MCP v${version}\n`);
        console.log('Graphs:');

        for (const status of statuses) {
          const defaultTag = status.default ? ' (default)' : '';
          const protectedTag = status.protected ? ' [protected]' : '';

          let connectionStatus = '';
          if (options.ping) {
            connectionStatus = status.connected
              ? '  ✓ connected'
              : `  ✗ ${status.error || 'connection failed'}`;
          }

          console.log(`  • ${status.name}${defaultTag}${protectedTag}${connectionStatus}`);
        }

        if (statuses.some(s => s.protected)) {
          console.log('\nWrite-protected graphs require --write-key flag for modifications.');
        }

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
