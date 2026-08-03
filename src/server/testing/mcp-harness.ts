/**
 * Harness for tests that drive the real MCP server over its real transport.
 *
 * Spawns `build/index.js --server`, completes the initialize handshake, and
 * exposes `list()` / `call()` so a test can exercise a tool exactly the way a
 * client does. Nothing here mocks anything inside the server: graph resolution,
 * write validation, the operation classes and the SDK all run. Point the server
 * at `tests/fake-roam-backend.mjs` via `preload` to fixture the wire instead.
 *
 * This exists because unit tests kept passing while tools were broken. A helper
 * proven correct in isolation says nothing about whether a tool calls it, and
 * a schema object carrying an annotation says nothing about whether the server
 * declares it. Both shipped broken; both are caught here.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';

const SERVER_ENTRY = 'build/index.js';

/**
 * Ask the OS for a free port. Test files run in parallel and stray servers
 * outlive the runs that spawned them, so a hardcoded port is a test that fails
 * for reasons having nothing to do with the code under test.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('no port assigned'))));
    });
  });
}

export interface HarnessOptions {
  /** Environment for the server, merged over the (sanitised) parent env. */
  env?: Record<string, string>;
  /** Module to `--import` before the server starts, e.g. the fake backend. */
  preload?: string;
}

export interface ToolResult {
  content?: { type: string; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  annotations?: Record<string, boolean>;
  inputSchema: Record<string, unknown>;
}

export class McpHarness {
  private child?: ChildProcess;
  private sessionId?: string;
  private rpcId = 1;
  private url = '';

  constructor(private readonly options: HarnessOptions = {}) {}

  async start(): Promise<void> {
    if (!existsSync(SERVER_ENTRY)) {
      throw new Error(`${SERVER_ENTRY} not found — run \`npx tsc\` (or \`npm test\`) first.`);
    }

    const port = await freePort();
    this.url = `http://127.0.0.1:${port}/mcp`;

    // Drop the parent vars that would silently invalidate a test's assumptions:
    //   HTTP_AUTH_TOKEN  — a shared daemon often runs with bearer auth set, and
    //     inheriting it 401s every request here.
    //   ROAM_GRAPHS      — outranks ROAM_API_TOKEN/ROAM_GRAPH_NAME, so inheriting
    //     it would aim a test at a REAL graph.
    //   ROAM_*           — likewise for the single-graph vars, the default-graph
    //     key, the write key, and the tag/page overrides.
    const parentEnv: Record<string, string | undefined> = { ...process.env };
    delete parentEnv.HTTP_AUTH_TOKEN;
    for (const key of Object.keys(parentEnv)) {
      if (key.startsWith('ROAM_')) delete parentEnv[key];
    }

    const args = this.options.preload
      ? ['--import', this.options.preload, SERVER_ENTRY, '--server']
      : [SERVER_ENTRY, '--server'];

    const child = spawn('node', args, {
      env: {
        ...parentEnv,
        HTTP_STREAM_PORT: String(port),
        ...this.options.env,
      } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.child = child;

    let stderr = '';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`server did not start in 10s. stderr:\n${stderr}`)),
        10000
      );
      child.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited early with code ${code}. stderr:\n${stderr}`));
      });
    });

    const init = await this.post({
      jsonrpc: '2.0',
      id: this.rpcId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'mcp-harness', version: '1.0.0' },
      },
    });
    if (!init.sessionId) {
      throw new Error(`initialize returned no session id: ${JSON.stringify(init.payload)}`);
    }
    this.sessionId = init.sessionId;
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  }

  /** Every tool the server declares, as the client sees it. */
  async list(): Promise<ToolDefinition[]> {
    const res = await this.post({ jsonrpc: '2.0', id: this.rpcId++, method: 'tools/list' });
    const payload = res.payload as { result?: { tools: ToolDefinition[] }; error?: unknown };
    if (!payload.result) throw new Error(`tools/list failed: ${JSON.stringify(payload.error)}`);
    return payload.result.tools;
  }

  /**
   * Call a tool. Returns the tool result on success, and on a JSON-RPC error
   * returns it shaped like a tool error so a caller can assert on either
   * without caring which layer refused — that distinction is an implementation
   * detail the client does not get to depend on.
   */
  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const res = await this.post({
      jsonrpc: '2.0',
      id: this.rpcId++,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    const payload = res.payload as {
      result?: ToolResult;
      error?: { code: number; message: string };
    };
    if (payload.result) return payload.result;
    return {
      isError: true,
      content: [{ type: 'text', text: payload.error?.message ?? JSON.stringify(payload) }],
    };
  }

  /** The text of a tool result, joined across content parts. */
  static text(result: ToolResult): string {
    return (result.content ?? []).map((c) => c.text).join('\n');
  }

  private async post(body: unknown) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    let payload: unknown = null;
    if (res.status !== 202) {
      const text = await res.text();
      const data = (res.headers.get('content-type') || '').includes('text/event-stream')
        ? text
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('')
        : text;
      try {
        payload = JSON.parse(data);
      } catch {
        payload = data;
      }
    }
    return { status: res.status, sessionId: res.headers.get('mcp-session-id'), payload };
  }
}
