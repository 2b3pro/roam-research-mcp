import { createServer } from 'node:net';

/**
 * Checks if a given port is currently in use.
 * @param port The port to check.
 * @param host Optional host to probe. When omitted, probes the wildcard address
 *   (any interface). Pass the host you intend to bind — a wildcard probe and a
 *   host-specific bind disagree in both directions, so the two must match or
 *   the answer is about a port nobody is going to open.
 * @returns A promise that resolves to true if the port is in use, and false otherwise.
 */
export function isPortInUse(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        // Handle other errors if necessary, but for this check, we assume other errors mean the port is available.
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(false);
    });

    if (host) {
      server.listen(port, host);
    } else {
      server.listen(port);
    }
  });
}

// `findAvailablePort` lived here until 3.1.0. It existed so stdio mode could
// drift to a free port when 8088 was taken, and it has no caller now that stdio
// opens no socket: `--server` binds the exact configured port and fails loudly
// rather than drifting, because a shared daemon must keep a stable URL.
// Anything reaching for it again probably wants that failure instead.
