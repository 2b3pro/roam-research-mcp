#!/usr/bin/env node
import { RoamServer } from './server/roam-server.js';

const server = new RoamServer();
server.run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
