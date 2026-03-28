import { Command } from 'commander';
import { runCommand } from './commands/run.js';

const program = new Command()
  .name('ananke')
  .description('Assertion-based testing tool for agentic applications')
  .version('0.1.0');

program.addCommand(runCommand);

program.parse();
