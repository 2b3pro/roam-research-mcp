#!/usr/bin/env node
import { RoamServer } from './server/roam-server.js';

// `--server` runs a long-lived, HTTP-only daemon (no stdio transport) bound to a
// pinned host:port — meant to be kept running (e.g. by a LaunchAgent) and shared
// by multiple MCP clients. Without the flag, behavior is unchanged: stdio + an
// auto-discovered HTTP port.
const serverMode = process.argv.includes('--server');

const server = new RoamServer();
server.run({ serverMode }).catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
