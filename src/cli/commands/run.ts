import { Command } from 'commander';
import pc from 'picocolors';
import {
  loadConfig,
  loadTestFile,
  findTestFiles,
  DEFAULT_TEST_PATTERNS,
} from '../../config/index.js';
import { runTest, type TestResult } from '../../runner/index.js';

export interface RunOptions {
  config?: string;
  verbose?: boolean;
  dryRun?: boolean;
}

export const runCommand = new Command('run')
  .description('Run test files')
  .argument('[patterns...]', 'Test file patterns (glob)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Verbose output')
  .option('-d, --dry-run', 'Validate tests without executing')
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

    // Dry run mode - just validate
    if (options.dryRun) {
      console.log(pc.green(`\n✓ Validated ${tests.length} test(s)`));
      for (const { test, filePath } of tests) {
        console.log(`  - ${test.name} (${filePath})`);
      }
      process.exit(0);
    }

    // Execute tests
    console.log('');
    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;

    for (const { test, filePath } of tests) {
      console.log(pc.cyan(`Running: ${test.name}`));
      if (verbose) {
        console.log(pc.dim(`  File: ${filePath}`));
      }

      try {
        const result = await runTest({
          config: configResult.config,
          test,
          verbose,
          onLog: (msg) => console.log(pc.dim(msg)),
        });

        results.push(result);

        if (result.passed) {
          passed++;
          console.log(pc.green(`  ✓ PASS`), pc.dim(`(${result.testData.endTs - result.testData.startTs}ms)`));
        } else {
          failed++;
          console.log(pc.red(`  ✗ FAIL`));
          if (result.error) {
            console.log(pc.red(`    ${result.error}`));
          }
          for (const failure of result.failures) {
            console.log(pc.red(`    - ${failure}`));
          }
        }
      } catch (err) {
        failed++;
        console.log(pc.red(`  ✗ ERROR: ${(err as Error).message}`));
      }
      console.log('');
    }

    // Summary
    console.log(pc.bold('─'.repeat(40)));
    console.log(
      pc.bold('Results:'),
      pc.green(`${passed} passed`),
      failed > 0 ? pc.red(`${failed} failed`) : pc.dim('0 failed')
    );

    process.exit(failed > 0 ? 1 : 0);
  });
