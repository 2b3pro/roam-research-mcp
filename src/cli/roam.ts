#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGetCommand } from './commands/get.js';
import { createSearchCommand } from './commands/search.js';
import { createSaveCommand } from './commands/save.js';
import { createRefsCommand } from './commands/refs.js';
import { createUpdateCommand } from './commands/update.js';
import { createBatchCommand } from './commands/batch.js';
import { createRenameCommand } from './commands/rename.js';
import { createStatusCommand } from './commands/status.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json to get the version
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const cliVersion = packageJson.version;

const program = new Command();

program
  .name('roam')
  .description('CLI for Roam Research')
  .version(cliVersion);

// Register subcommands
program.addCommand(createGetCommand());
program.addCommand(createSearchCommand());
program.addCommand(createSaveCommand());
program.addCommand(createRefsCommand());
program.addCommand(createUpdateCommand());
program.addCommand(createBatchCommand());
program.addCommand(createRenameCommand());
program.addCommand(createStatusCommand());

// Parse arguments
program.parse();
