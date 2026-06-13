import { Command } from 'commander';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpGet } from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the MCP server entry (build/index.js) relative to this command
// (build/cli/commands/server.js -> build/index.js).
const SERVER_ENTRY = join(__dirname, '../../index.js');

// State dir for the CLI-managed daemon (pidfile + logfile). Local path by
// default — overridable via ROAM_HOME. Kept off external volumes so launchd /
// the daemon never hits the macOS provenance-xattr EPERM trap.
const STATE_DIR = process.env.ROAM_HOME || join(homedir(), '.roam');
const PID_FILE = join(STATE_DIR, 'server.pid');
const LOG_FILE = join(STATE_DIR, 'server.log');

const DEFAULT_PORT = process.env.HTTP_STREAM_PORT || '8088';
const DEFAULT_HOST = process.env.HTTP_STREAM_HOST || '127.0.0.1';

interface HealthInfo {
  status: string;
  name?: string;
  version?: string;
  mode?: string;
  auth?: string;
  graphs?: string[];
  defaultGraph?: string;
  activeSessions?: number;
}

/** Probe GET /health. Returns parsed info, or null if nothing is serving. */
function checkHealth(host: string, port: string, timeoutMs = 2000): Promise<HealthInfo | null> {
  // 0.0.0.0 is a bind address, not a connect address — probe loopback instead.
  const target = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return new Promise((resolve) => {
    const req = httpGet({ host: target, port, path: '/health', timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as HealthInfo);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, 'utf8').trim();
  const pid = parseInt(raw, 10);
  return Number.isFinite(pid) ? pid : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but we can't signal it; ESRCH means gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createStartCommand(): Command {
  return new Command('start')
    .description('Start the shared HTTP MCP server (HTTP-only daemon)')
    .option('-p, --port <port>', 'Port to bind', DEFAULT_PORT)
    .option('-H, --host <host>', 'Host to bind (use 0.0.0.0 to expose on LAN)', DEFAULT_HOST)
    .option('-f, --foreground', 'Run in the foreground instead of detaching', false)
    .action(async (options: { port: string; host: string; foreground?: boolean }) => {
      const { port, host, foreground } = options;

      // Don't start a second copy if one is already serving this address.
      const existing = await checkHealth(host, port);
      if (existing) {
        console.log(`Already running on http://${host}:${port}/ (v${existing.version ?? '?'}, ${existing.activeSessions ?? 0} session(s)).`);
        return;
      }

      if (!existsSync(SERVER_ENTRY)) {
        console.error(`Error: server entry not found at ${SERVER_ENTRY}. Run "npm run build" first.`);
        process.exit(1);
      }

      const env = { ...process.env, HTTP_STREAM_PORT: port, HTTP_STREAM_HOST: host };

      if (foreground) {
        const child = spawn(process.execPath, [SERVER_ENTRY, '--server'], { env, stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code ?? 0));
        return;
      }

      // Detached background launch: logs to LOG_FILE, pid recorded in PID_FILE.
      if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
      const out = openSync(LOG_FILE, 'a');
      const child = spawn(process.execPath, [SERVER_ENTRY, '--server'], {
        env,
        detached: true,
        stdio: ['ignore', out, out],
      });
      child.unref();

      if (child.pid) writeFileSync(PID_FILE, String(child.pid));

      // Confirm it actually came up (port-in-use fails loudly and exits).
      let health: HealthInfo | null = null;
      for (let i = 0; i < 10 && !health; i++) {
        await sleep(300);
        if (child.pid && !isAlive(child.pid)) break;
        health = await checkHealth(host, port);
      }

      if (health) {
        console.log(`Started (pid ${child.pid}) on http://${host}:${port}/`);
        console.log(`  health: http://${host}:${port}/health`);
        console.log(`  logs:   ${LOG_FILE}  (roam server logs -f)`);
      } else {
        console.error(`Failed to confirm startup. Check logs: ${LOG_FILE}`);
        if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
        process.exit(1);
      }
    });
}

function createStopCommand(): Command {
  return new Command('stop')
    .description('Stop a CLI-started server (see notes for service-managed daemons)')
    .option('-H, --host <host>', 'Host to probe', DEFAULT_HOST)
    .option('-p, --port <port>', 'Port to probe', DEFAULT_PORT)
    .action(async (options: { host: string; port: string }) => {
      const pid = readPid();

      if (pid && isAlive(pid)) {
        process.kill(pid, 'SIGTERM');
        for (let i = 0; i < 20 && isAlive(pid); i++) await sleep(100);
        if (isAlive(pid)) {
          console.error(`Process ${pid} did not stop after SIGTERM.`);
          process.exit(1);
        }
        if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
        console.log(`Stopped (pid ${pid}).`);
        return;
      }

      if (existsSync(PID_FILE)) unlinkSync(PID_FILE);

      // No CLI-managed process — but something may still be serving via a
      // service manager (launchd/systemd). Don't pretend we stopped it.
      const health = await checkHealth(options.host, options.port);
      if (health) {
        console.log(`Not started by this CLI, but a server is responding on http://${options.host}:${options.port}/.`);
        console.log(`It is likely managed by a service manager (e.g. launchd/systemd) — stop it there.`);
        return;
      }
      console.log('Not running.');
    });
}

function createStatusCommand(): Command {
  return new Command('status')
    .description('Check whether the shared HTTP server is running')
    .option('-H, --host <host>', 'Host to probe', DEFAULT_HOST)
    .option('-p, --port <port>', 'Port to probe', DEFAULT_PORT)
    .option('--json', 'Output as JSON', false)
    .action(async (options: { host: string; port: string; json?: boolean }) => {
      const { host, port } = options;
      const health = await checkHealth(host, port);
      const pid = readPid();
      const pidAlive = pid !== null && isAlive(pid);

      if (options.json) {
        console.log(JSON.stringify({
          running: !!health,
          url: `http://${host}:${port}/mcp`,
          managedPid: pidAlive ? pid : null,
          health: health ?? null,
        }, null, 2));
        return;
      }

      if (health) {
        console.log(`● running — http://${host}:${port}/`);
        console.log(`  version:        ${health.version ?? '?'}`);
        console.log(`  mode:           ${health.mode ?? '?'}`);
        console.log(`  auth:           ${health.auth ?? 'none'}`);
        console.log(`  graphs:         ${(health.graphs ?? []).join(', ')}`);
        console.log(`  default graph:  ${health.defaultGraph ?? '?'}`);
        console.log(`  active sessions:${' '}${health.activeSessions ?? 0}`);
        console.log(`  endpoint:       http://${host}:${port}/mcp`);
        console.log(pidAlive
          ? `  managed by:     this CLI (pid ${pid})`
          : `  managed by:     external supervisor (not this CLI)`);
      } else {
        console.log(`○ not running on http://${host}:${port}/`);
        if (pidAlive) console.log(`  (stale pidfile process ${pid} alive but not serving — try: roam server stop)`);
      }
    });
}

function createLogsCommand(): Command {
  return new Command('logs')
    .description('Tail the CLI-managed server log')
    .option('-f, --follow', 'Follow the log (like tail -f)', false)
    .option('-n, --lines <n>', 'Number of lines to show', '50')
    .action((options: { follow?: boolean; lines: string }) => {
      if (!existsSync(LOG_FILE)) {
        console.error(`No CLI log at ${LOG_FILE}.`);
        console.error('The server may not have been started via "roam server start"');
        console.error('(e.g. a launchd/systemd service logs to its own configured path).');
        process.exit(1);
      }
      const args = ['-n', options.lines];
      if (options.follow) args.push('-f');
      args.push(LOG_FILE);
      const child = spawn('tail', args, { stdio: 'inherit' });
      child.on('exit', (code) => process.exit(code ?? 0));
    });
}

export function createServerCommand(): Command {
  const server = new Command('server')
    .description('Run/manage the shared HTTP MCP server (start/stop/status/logs)')
    .addHelpText('after', `
The shared server is a single long-lived, HTTP-only MCP daemon that multiple
clients connect to over HTTP — instead of each session spawning its own copy.
Point clients at it with:  { "type": "http", "url": "http://${DEFAULT_HOST}:${DEFAULT_PORT}/mcp" }

Examples:
  roam server start                 # start in the background (port ${DEFAULT_PORT})
  roam server start -p 9000 -f      # foreground on port 9000
  roam server start -H 0.0.0.0      # expose on the LAN (no transport auth!)
  roam server status                # is it up? version, graphs, sessions
  roam server logs -f               # follow the log
  roam server stop                  # stop a CLI-started daemon

Config comes from the environment (ROAM_GRAPHS / ROAM_API_TOKEN, etc.), same
as the rest of the CLI. State dir: ${STATE_DIR} (override with ROAM_HOME).
For an always-on daemon, run "roam server start" from a launchd/systemd unit.
`);

  server.addCommand(createStartCommand());
  server.addCommand(createStopCommand());
  server.addCommand(createStatusCommand());
  server.addCommand(createLogsCommand());

  // No subcommand → show help rather than erroring.
  server.action(() => server.help());

  return server;
}
