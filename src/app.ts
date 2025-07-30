#!/usr/bin/env node
import { RoamServer } from './server/roam-server.js';

const server = new RoamServer();
server.run().catch(() => { /* handle error silently */ });
