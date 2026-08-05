import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { connect } from 'node:net';

/**
 * Regression test for the stdio-mode companion HTTP transport's bind host.
 *
 * In stdio mode (the default when an MCP client spawns us) the server also
 * opens an HTTP Stream transport. That listener used to be created with
 * `listen(port)` and no host, which binds every interface — publishing an
 * MCP endpoint for the graph on the LAN. `HTTP_AUTH_TOKEN` is normally unset
 * in stdio mode because loopback *is* the perimeter, so anyone on the network
 * could read the graphs and write the unprotected ones without a Roam token.
 *
 * A unit test on `findAvailablePort` cannot catch this: the bug is in the
 * argument the server passes to `listen`, so the assertion has to be made
 * against a real spawned server and a real socket.
 *
 * Run against the built server; `npm test` compiles first via `pretest`.
 * Spawned with fake Roam credentials — /health never touches the Roam backend.
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

beforeAll(async () => {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`${SERVER_ENTRY} not found — run \`npx tsc\` (or \`npm test\`) first.`);
  }
  // No --server: this is the stdio path, the one that used to bind wildcard.
  child = spawn('node', [SERVER_ENTRY], {
    env: {
      ...parentEnv,
      ROAM_API_TOKEN: 'fake-token-for-tests',
      ROAM_GRAPH_NAME: 'fake-graph',
      HTTP_STREAM_PORT: String(PORT),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // The stdio path logs nothing when the companion transport comes up, so poll
  // /health on loopback instead of watching stderr.
  const deadline = Date.now() + 15000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('companion HTTP transport did not come up in 15s');
    await new Promise((r) => setTimeout(r, 200));
  }
}, 20000);

afterAll(() => {
  if (child.exitCode === null && child.signalCode === null) {
    return new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  }
});

describe('stdio-mode companion HTTP transport', () => {
  it('serves /health on loopback', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; mode: string; auth: string };
    expect(body.status).toBe('ok');
    // Guards the premise: if this said 'server' the test would be exercising
    // the --server path, which was never the vulnerable one.
    expect(body.mode).toBe('stdio+http');
    // And the premise for why the bind host matters: nothing else gates access.
    expect(body.auth).toBe('none');
  });

  it('is unreachable on loopback in another instance', async () => {
    // Sanity check on `probe` itself — a port nobody listens on must read as
    // refused, otherwise the LAN assertion below could pass for a bad reason.
    expect(await probe('127.0.0.1', PORT + 1)).toBe('refused');
  });

  it.skipIf(!lanAddress())('does not accept connections on a LAN interface', async () => {
    const host = lanAddress()!;
    expect(await probe(host, PORT)).not.toBe('connected');
  });
});
