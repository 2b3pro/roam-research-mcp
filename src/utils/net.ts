import { createServer } from 'node:net';

/**
 * Checks if a given port is currently in use.
 * @param port The port to check.
 * @param host Optional host to probe. When omitted, probes the wildcard address
 *   (any interface) — matching `findAvailablePort`'s "globally free" semantics.
 *   Pass a specific host (e.g. `127.0.0.1`) to check only that interface, so a
 *   listener bound to a different interface (e.g. wildcard) doesn't register as
 *   a conflict for a host-specific bind.
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

/**
 * Finds an available port, starting from a given port and incrementing by a specified amount.
 * @param startPort The port to start checking from.
 * @param incrementBy The amount to increment the port by if it's in use. Defaults to 2.
 * @param host Optional host to probe. Pass the host you intend to bind — probing
 *   the wildcard while binding a specific host misses conflicts (an IPv6-wildcard
 *   probe succeeds alongside an existing 127.0.0.1 listener), so concurrent
 *   instances would all pick the same port and crash with EADDRINUSE.
 * @returns A promise that resolves to an available port number.
 */
export async function findAvailablePort(startPort: number, incrementBy = 2, host?: string): Promise<number> {
  let port = startPort;
  while (await isPortInUse(port, host)) {
    port += incrementBy;
  }
  return port;
}
