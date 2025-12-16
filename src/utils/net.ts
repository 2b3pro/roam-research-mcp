import { createServer } from 'node:net';

/**
 * Checks if a given port is currently in use.
 * @param port The port to check.
 * @returns A promise that resolves to true if the port is in use, and false otherwise.
 */
export function isPortInUse(port: number): Promise<boolean> {
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

    server.listen(port);
  });
}

/**
 * Finds an available port, starting from a given port and incrementing by a specified amount.
 * @param startPort The port to start checking from.
 * @param incrementBy The amount to increment the port by if it's in use. Defaults to 2.
 * @returns A promise that resolves to an available port number.
 */
export async function findAvailablePort(startPort: number, incrementBy = 2): Promise<number> {
  let port = startPort;
  while (await isPortInUse(port)) {
    port += incrementBy;
  }
  return port;
}
