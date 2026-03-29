import { Command } from 'commander';
import { runCommand } from './commands/run.js';

// PACKAGE_VERSION is injected by tsup's `define` at build time.
// Falls back to 'dev' when running unbundled (e.g. tsx).
const version = typeof PACKAGE_VERSION !== 'undefined' ? PACKAGE_VERSION : 'dev';
declare const PACKAGE_VERSION: string;

const program = new Command()
  .name('ananke')
  .description('Assertion-based testing tool for agentic applications')
  .version(version);

program.addCommand(runCommand);

program.parse();
