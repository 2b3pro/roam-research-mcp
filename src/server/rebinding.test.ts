import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { existsSync } from 'node:fs';
import { freePort } from './testing/mcp-harness.js';

/**
 * DNS rebinding, at the wire. A page that points its own hostname at 127.0.0.1
 * reaches the server as same-origin, so CORS never applies; the Host it names
 * and the Origin it sends are what give it away. Without a token the server
 * must refuse both before answering anything, /health included. With a token
 * it must behave exactly as before. Spawned with fake Roam credentials:
 * initialize never touches the Roam backend.
 */

const SERVER_ENTRY = 'build/index.js';
const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'rebinding-test', version: '1.0.0' },
  },
});

const children: ChildProcess[] = [];

/** Start a real --server on a free port, with `env` over fake credentials. */
async function startServer(env: Record<string, string> = {}): Promise<number> {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`${SERVER_ENTRY} not found — run \`npx tsc\` (or \`npm test\`) first.`);
  }
  const port = await freePort();
  const child = spawn('node', [SERVER_ENTRY, '--server'], {
    env: {
      ...process.env,
      // Blanked, not omitted (see session-404.test.ts), so neither the parent
      // env nor the repo-root .env can change what these tests expect.
      HTTP_AUTH_TOKEN: '',
      ROAM_GRAPHS: '',
      HTTP_ALLOWED_HOSTS: '',
      CORS_ORIGIN: '',
      ROAM_API_TOKEN: 'fake-token-for-tests',
      ROAM_GRAPH_NAME: 'fake-graph',
      HTTP_STREAM_PORT: String(port),
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.push(child);
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
  return port;
}

afterAll(async () => {
  await Promise.all(
    children.map((child) =>
      child.exitCode === null && child.signalCode === null
        ? new Promise<void>((resolve) => {
            child.once('exit', () => resolve());
            child.kill('SIGTERM');
          })
        : Promise.resolve()
    )
  );
});

interface Reply {
  status: number;
  sessionId?: string;
  body: string;
}

/**
 * One raw HTTP request to 127.0.0.1:port. Raw so the test sets Host itself:
 * the connection goes to this server, while the header says what a browser on
 * a rebinding page would say.
 */
function send(
  port: number,
  opts: { method?: string; path?: string; host?: string; origin?: string; token?: string } = {}
): Promise<Reply> {
  const method = opts.method ?? 'POST';
  const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${port}` };
  if (method === 'POST') {
    headers['content-type'] = 'application/json';
    headers.accept = 'application/json, text/event-stream';
  }
  if (opts.origin) headers.origin = opts.origin;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method, path: opts.path ?? '/mcp', headers, timeout: 10000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            sessionId: res.headers['mcp-session-id'] as string | undefined,
            body,
          })
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (method === 'POST') req.write(INITIALIZE);
    req.end();
  });
}

describe('without a token', () => {
  let port: number;
  beforeAll(async () => {
    port = await startServer();
  }, 15000);

  it('answers requests addressed to localhost or an IP address', async () => {
    for (const host of [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `localhost.:${port}`,
      `[::1]:${port}`,
      `192.0.2.10:${port}`,
    ]) {
      const res = await send(port, { host });
      expect(res.status, host).toBe(200);
      expect(res.sessionId, host).toBeTruthy();
    }
  });

  it('refuses a Host it does not answer to, before initialize or /health', async () => {
    const init = await send(port, { host: `evil.example:${port}` });
    expect(init.status).toBe(403);
    expect(init.sessionId).toBeUndefined();
    expect(JSON.parse(init.body).error.message).toMatch(/HTTP_ALLOWED_HOSTS/);

    const health = await send(port, { method: 'GET', path: '/health', host: `evil.example:${port}` });
    expect(health.status).toBe(403);
    expect(health.body).not.toMatch(/graphs/);
  });

  it('refuses an Origin that CORS_ORIGIN does not allow, and answers one it does', async () => {
    const evil = await send(port, { origin: `http://evil.example:${port}` });
    expect(evil.status).toBe(403);
    expect(JSON.parse(evil.body).error.message).toMatch(/CORS_ORIGIN/);

    const roam = await send(port, { origin: 'https://roamresearch.com' });
    expect(roam.status).toBe(200);
  });

  it('leaves preflights to the CORS headers', async () => {
    const res = await send(port, { method: 'OPTIONS', origin: 'http://evil.example' });
    expect(res.status).toBe(204);
  });
});

describe('without a token, with HTTP_ALLOWED_HOSTS and CORS_ORIGIN set', () => {
  let port: number;
  beforeAll(async () => {
    port = await startServer({
      HTTP_ALLOWED_HOSTS: 'roam-mcp:8088, Other.LAN',
      CORS_ORIGIN: 'http://localhost:6274',
    });
  }, 15000);

  it('answers listed hostnames on any port, and no other name', async () => {
    expect((await send(port, { host: 'roam-mcp:8048' })).status).toBe(200);
    expect((await send(port, { host: 'other.lan' })).status).toBe(200);
    expect((await send(port, { host: `evil.example:${port}` })).status).toBe(403);
  });

  it('allows exactly the configured origins', async () => {
    expect((await send(port, { origin: 'http://localhost:6274' })).status).toBe(200);
    expect((await send(port, { origin: 'https://roamresearch.com' })).status).toBe(403);
  });
});

describe('with a token', () => {
  const token = 'rebinding-test-token';
  let port: number;
  beforeAll(async () => {
    port = await startServer({ HTTP_AUTH_TOKEN: token });
  }, 15000);

  it('answers any Host and Origin that carry the token, as before', async () => {
    const res = await send(port, { host: `evil.example:${port}`, origin: 'http://evil.example', token });
    expect(res.status).toBe(200);
    expect(res.sessionId).toBeTruthy();
  });

  it('still refuses them without the token', async () => {
    const res = await send(port, { host: `evil.example:${port}` });
    expect(res.status).toBe(401);
  });
});
