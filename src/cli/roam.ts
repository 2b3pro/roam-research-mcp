#!/usr/bin/env node

import { Command } from 'commander';
import { createGetCommand } from './commands/get.js';
import { createSearchCommand } from './commands/search.js';
import { createSaveCommand } from './commands/save.js';

const program = new Command();

program
  .name('roam')
  .description('CLI for Roam Research')
  .version('1.5.0');

// Register subcommands
program.addCommand(createGetCommand());
program.addCommand(createSearchCommand());
program.addCommand(createSaveCommand());

// Parse arguments
program.parse();
