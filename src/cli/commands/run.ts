import { Command } from 'commander';
import pc from 'picocolors';
import {
  loadConfig,
  loadTestFile,
  findTestFiles,
  DEFAULT_TEST_PATTERNS,
} from '../../config/index.js';

export interface RunOptions {
  config?: string;
  verbose?: boolean;
}

export const runCommand = new Command('run')
  .description('Run test files')
  .argument('[patterns...]', 'Test file patterns (glob)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (patterns: string[], options: RunOptions) => {
    const verbose = options.verbose ?? false;

    // Load project config
    if (verbose) {
      console.log(pc.dim('Loading config...'));
    }

    let configResult;
    try {
      configResult = loadConfig({ configPath: options.config });
    } catch (err) {
      console.error(pc.red('Error:'), (err as Error).message);
      process.exit(1);
    }

    if (verbose) {
      console.log(pc.dim(`Config loaded from: ${configResult.configPath}`));
      console.log(pc.dim(`Endpoint: ${configResult.config.target.endpoint}`));
    }

    // Find test files
    const testPatterns =
      patterns.length > 0 ? patterns : DEFAULT_TEST_PATTERNS;
    const cwd = process.cwd();

    if (verbose) {
      console.log(pc.dim(`Finding tests with patterns: ${testPatterns.join(', ')}`));
    }

    let testFiles;
    try {
      testFiles = await findTestFiles(testPatterns, cwd);
    } catch (err) {
      console.error(pc.red('Error finding test files:'), (err as Error).message);
      process.exit(1);
    }

    if (testFiles.length === 0) {
      console.log(pc.yellow('No test files found.'));
      process.exit(0);
    }

    console.log(pc.cyan(`Found ${testFiles.length} test file(s)\n`));

    // Load and validate each test file
    let hasErrors = false;
    const tests: Array<{ test: ReturnType<typeof loadTestFile>['test']; filePath: string }> = [];

    for (const filePath of testFiles) {
      try {
        const { test } = loadTestFile(filePath);
        tests.push({ test, filePath });
        if (verbose) {
          console.log(pc.green('  ✓'), pc.dim(filePath), pc.dim(`(${test.turns.length} turns)`));
        }
      } catch (err) {
        hasErrors = true;
        console.error(pc.red('  ✗'), filePath);
        console.error(pc.red('   '), (err as Error).message);
      }
    }

    if (hasErrors) {
      console.error(pc.red('\nSome test files failed validation.'));
      process.exit(1);
    }

    // TODO: Phase 2+ - Execute tests
    console.log(pc.dim('\nTest execution not yet implemented.'));
    console.log(pc.cyan(`\nLoaded ${tests.length} test(s):`));
    for (const { test, filePath } of tests) {
      console.log(`  - ${test.name} (${filePath})`);
    }
  });
