import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Integration test for unknown-session handling, run against the built server.
 * `npm test` compiles first via the `pretest` script; if you invoke vitest
 * directly, run `tsc` yourself. Spawned with fake Roam credentials — initialize
 * and tools/list never touch the Roam backend.
 */

const PORT = 8478;
const URL_MCP = `http://127.0.0.1:${PORT}/mcp`;
const SERVER_ENTRY = 'build/index.js';

// Inherit the parent env, minus the vars that would silently invalidate this
// test's assumptions:
//   HTTP_AUTH_TOKEN — a shared daemon is often run with bearer auth set, and
//     inheriting it 401s every request here, failing both cases confusingly.
//   ROAM_GRAPHS     — takes precedence over ROAM_API_TOKEN/ROAM_GRAPH_NAME, so
//     inheriting it would quietly point the server at a real graph despite the
//     fake credentials below.
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

let rpcId = 1;

async function post(body: unknown, sessionId?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(URL_MCP, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  let payload: unknown = null;
  const ctype = res.headers.get('content-type') || '';
  if (res.status !== 202) {
    const text = await res.text();
    const data = ctype.includes('text/event-stream')
      ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
      : text;
    try { payload = JSON.parse(data); } catch { payload = data; }
  }
  return { status: res.status, sessionId: res.headers.get('mcp-session-id'), payload };
}

describe('unknown session IDs', () => {
  it('routes a live session normally', async () => {
    const init = await post({
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'session-404-test', version: '1.0.0' },
      },
    });
    expect(init.status).toBe(200);
    expect(init.sessionId).toBeTruthy();
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId!);

    const res = await post({ jsonrpc: '2.0', id: rpcId++, method: 'tools/list' }, init.sessionId!);
    expect(res.status).toBe(200);
    expect((res.payload as { result: { tools: unknown[] } }).result.tools.length).toBeGreaterThan(0);
  });

  it('answers an unknown session ID with an immediate 404 JSON-RPC error', async () => {
    const started = Date.now();
    const res = await post(
      { jsonrpc: '2.0', id: rpcId++, method: 'tools/list' },
      'deadbeefdeadbeefdeadbeef'
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(res.status).toBe(404);
    const payload = res.payload as { jsonrpc: string; error: { code: number; message: string } };
    expect(payload.jsonrpc).toBe('2.0');
    expect(payload.error.code).toBe(-32001);
    expect(payload.error.message).toMatch(/session not found/i);
  });
});
