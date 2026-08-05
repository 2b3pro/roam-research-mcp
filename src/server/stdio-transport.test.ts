import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { connect } from 'node:net';

/**
 * Stdio mode must open no listening socket — not on the LAN, not on loopback.
 *
 * Until 3.1.0 it opened an HTTP Stream transport alongside stdio, and did so
 * with `listen(port)` and no host, which binds every interface. Since
 * `HTTP_AUTH_TOKEN` is normally unset in stdio mode (loopback *was* the
 * perimeter), every spawned instance published a token-free MCP endpoint for
 * its graph on the network. The modes are now mutually exclusive: stdio speaks
 * over stdin/stdout, `--server` speaks HTTP, neither does both.
 *
 * The assertion has to be made against a spawned server and a real socket —
 * the defect was in what the server passed to `listen()`, which no unit test
 * observes. Verified against pre-3.1.0 builds, where both port assertions fail.
 *
 * Run against the built server; `npm test` compiles first via `pretest`.
 * Spawned with fake Roam credentials — a `tools/list` never reaches Roam.
 */

const PORT = 8722;
const SERVER_ENTRY = 'build/index.js';

// See session-404.test.ts: HTTP_AUTH_TOKEN would gate requests the test expects
// to be open, and ROAM_GRAPHS would override the fake single-graph credentials
// and point a spawned server at a real graph.
const { HTTP_AUTH_TOKEN: _auth, ROAM_GRAPHS: _graphs, ...parentEnv } = process.env;

/** First non-internal IPv4 address, i.e. one reachable from the LAN. */
function lanAddress(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return undefined;
}

/** Resolves 'connected' | 'refused' | 'timeout' for a bare TCP connect. */
function probe(host: string, port: number, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: string) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done('connected'));
    socket.once('timeout', () => done('timeout'));
    socket.once('error', () => done('refused'));
  });
}

let child: ChildProcess;
let stderr = '';

/** Reads one line-delimited JSON-RPC response matching `id` from stdout. */
function rpc(request: object, id: number, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      child.stdout!.off('data', onData);
      reject(new Error(`no response to id ${id} in ${timeoutMs}ms; stderr: ${stderr}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === id) {
            clearTimeout(timer);
            child.stdout!.off('data', onData);
            resolve(message);
            return;
          }
        } catch {
          // not JSON — ignore
        }
      }
    };
    child.stdout!.on('data', onData);
    child.stdin!.write(JSON.stringify(request) + '\n');
  });
}

beforeAll(async () => {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`${SERVER_ENTRY} not found — run \`npx tsc\` (or \`npm test\`) first.`);
  }
  // No --server: this is the stdio path, the one that used to bind a port.
  child = spawn('node', [SERVER_ENTRY], {
    env: {
      ...parentEnv,
      ROAM_API_TOKEN: 'fake-token-for-tests',
      ROAM_GRAPH_NAME: 'fake-graph',
      HTTP_STREAM_PORT: String(PORT),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  // Handshake over stdio. This doubles as the readiness signal: a reply means
  // startup finished, so a port that is not open by now is not going to be.
  const init = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'stdio-transport-test', version: '1.0.0' },
    },
  }, 1);
  if (!init.result) throw new Error(`initialize failed: ${JSON.stringify(init)}`);
  child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
}, 20000);

afterAll(() => {
  if (child?.exitCode === null && child?.signalCode === null) {
    return new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  }
});

describe('stdio mode', () => {
  it('serves tools over stdio', async () => {
    // The premise: the server is alive and fully functional on this transport,
    // so the closed ports below are a deliberate choice and not a dead process.
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 2);
    expect(res.result.tools.length).toBeGreaterThan(0);
  });

  it('opens no HTTP listener on loopback', async () => {
    expect(await probe('127.0.0.1', PORT)).toBe('refused');
  });

  it.skipIf(!lanAddress())('opens no HTTP listener on a LAN interface', async () => {
    // Distinct from the loopback case: the pre-3.1.0 bind covered both, and a
    // partial fix that bound loopback only would pass the LAN check alone.
    expect(await probe(lanAddress()!, PORT)).not.toBe('connected');
  });

  it('leaves the process listening on nothing at all', async () => {
    // Belt and braces against a listener drifting to another port, which is
    // exactly what the old auto-port fallback did when 8722 was taken.
    const { execFileSync } = await import('node:child_process');
    let out = '';
    try {
      out = execFileSync('lsof', ['-a', '-p', String(child.pid), '-i', 'TCP', '-sTCP:LISTEN'], {
        encoding: 'utf8',
      });
    } catch {
      // lsof exits non-zero when it finds nothing, which is the passing case.
    }
    expect(out.trim()).toBe('');
  });
});
