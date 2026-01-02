#!/usr/bin/env node

import { Command } from 'commander';
import { createGetCommand } from './commands/get.js';
import { createSearchCommand } from './commands/search.js';
import { createSaveCommand } from './commands/save.js';
import { createRefsCommand } from './commands/refs.js';
import { createUpdateCommand } from './commands/update.js';

const program = new Command();

program
  .name('roam')
  .description('CLI for Roam Research')
  .version('1.8.1');

// Register subcommands
program.addCommand(createGetCommand());
program.addCommand(createSearchCommand());
program.addCommand(createSaveCommand());
program.addCommand(createRefsCommand());
program.addCommand(createUpdateCommand());

// Parse arguments
program.parse();
