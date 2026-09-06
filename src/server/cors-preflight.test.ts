import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Browser clients on the HTTP transport must pass a CORS preflight before any
 * MCP request. Since protocol revision 2025-06-18 a client MUST send
 * `MCP-Protocol-Version` on every request after initialization, and SSE
 * resumption sends `Last-Event-ID`. If either is missing from
 * `Access-Control-Allow-Headers`, the preflight fails and the browser never
 * issues the real request — with no server-side log line to show for it.
 * Non-browser clients skip preflight entirely, which is how this stayed
 * invisible.
 *
 * Run against the built server, spawned with fake Roam credentials: an OPTIONS
 * request never reaches the Roam backend.
 */

const PORT = 8479;
const URL_MCP = `http://127.0.0.1:${PORT}/mcp`;
const SERVER_ENTRY = 'build/index.js';

// See session-404.test.ts for why these two are stripped from the parent env.
const { HTTP_AUTH_TOKEN: _auth, ROAM_GRAPHS: _graphs, ...parentEnv } = process.env;

let child: ChildProcess;

beforeAll(async () => {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`${SERVER_ENTRY} not found — run \`npx tsc\` (or \`npm test\`) first.`);
  }
  child = spawn('node', [SERVER_ENTRY, '--server'], {
    env: {
      ...parentEnv,
      ROAM_API_TOKEN: 'fake-token-for-tests',
      ROAM_GRAPH_NAME: 'fake-graph',
      HTTP_STREAM_PORT: String(PORT),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in 10s')), 10000);
    child.stderr!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}`));
    });
  });
}, 15000);

afterAll(() => {
  if (child.exitCode === null && child.signalCode === null) {
    return new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  }
});

/** The request headers an MCP-over-HTTP browser client sends after initialize. */
const REQUIRED_REQUEST_HEADERS = ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];

describe('CORS preflight on the MCP endpoint', () => {
  it('answers OPTIONS with 204 and allows every header an MCP client must send', async () => {
    const res = await fetch(URL_MCP, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': REQUIRED_REQUEST_HEADERS.join(', '),
      },
      signal: AbortSignal.timeout(10000),
    });

    expect(res.status).toBe(204);

    // Header names are case-insensitive on the wire; compare lower-cased.
    const allowed = (res.headers.get('access-control-allow-headers') || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);

    const missing = REQUIRED_REQUEST_HEADERS.filter((h) => !allowed.includes(h));
    expect(missing, `headers a browser preflight would reject`).toEqual([]);
  });
});
