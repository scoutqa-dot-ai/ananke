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
  debug?: boolean;
  dryRun?: boolean;
  json?: boolean;
  record?: string;
  replay?: string;
}

export const runCommand = new Command('run')
  .description('Run test files')
  .argument('[patterns...]', 'Test file patterns (glob)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Verbose output')
  .option('--debug', 'Debug output (detailed request/response logs)')
  .option('-d, --dry-run', 'Validate tests without executing')
  .option('--json', 'Output results as JSON')
  .option('--record <dir>', 'Record events to directory')
  .option('--replay <dir>', 'Replay events from directory')
  .action(async (patterns: string[], options: RunOptions) => {
    const verbose = options.verbose ?? false;
    const debugMode = options.debug ?? false;
    const jsonOutput = options.json ?? false;
    const recordDir = options.record;
    const replayDir = options.replay;

    // Validate mutually exclusive options
    if (recordDir && replayDir) {
      console.error(pc.red('Error: --record and --replay are mutually exclusive'));
      process.exit(1);
    }

    // Helper for conditional console output (suppressed in JSON mode)
    const log = jsonOutput ? () => {} : console.log;
    const logError = jsonOutput ? () => {} : console.error;

    // Load project config
    if (verbose) {
      log(pc.dim('Loading config...'));
    }

    let configResult;
    try {
      configResult = loadConfig({ configPath: options.config });
    } catch (err) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: (err as Error).message }, null, 2));
      } else {
        logError(pc.red('Error:'), (err as Error).message);
      }
      process.exit(1);
    }

    if (verbose) {
      log(pc.dim(`Config loaded from: ${configResult.configPath}`));
      log(pc.dim(`Endpoint: ${configResult.config.target.endpoint}`));
    }

    // Find test files
    const testPatterns =
      patterns.length > 0 ? patterns : DEFAULT_TEST_PATTERNS;
    const cwd = process.cwd();

    if (verbose) {
      log(pc.dim(`Finding tests with patterns: ${testPatterns.join(', ')}`));
    }

    let testFiles;
    try {
      testFiles = await findTestFiles(testPatterns, cwd);
    } catch (err) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: (err as Error).message }, null, 2));
      } else {
        logError(pc.red('Error finding test files:'), (err as Error).message);
      }
      process.exit(1);
    }

    if (testFiles.length === 0) {
      if (jsonOutput) {
        console.log(JSON.stringify({ tests: [], passed: 0, failed: 0 }, null, 2));
      } else {
        log(pc.yellow('No test files found.'));
      }
      process.exit(0);
    }

    log(pc.cyan(`Found ${testFiles.length} test file(s)\n`));

    // Load and validate each test file
    let hasErrors = false;
    const tests: Array<{ test: ReturnType<typeof loadTestFile>['test']; filePath: string }> = [];

    for (const filePath of testFiles) {
      try {
        const { test } = loadTestFile(filePath);
        tests.push({ test, filePath });
        if (verbose) {
          log(pc.green('  ✓'), pc.dim(filePath), pc.dim(`(${test.turns.length} turns)`));
        }
      } catch (err) {
        hasErrors = true;
        logError(pc.red('  ✗'), filePath);
        logError(pc.red('   '), (err as Error).message);
      }
    }

    if (hasErrors) {
      logError(pc.red('\nSome test files failed validation.'));
      process.exit(1);
    }

    // Dry run mode - just validate
    if (options.dryRun) {
      if (jsonOutput) {
        console.log(JSON.stringify({
          validated: tests.map(t => ({ name: t.test.name, file: t.filePath })),
        }, null, 2));
      } else {
        log(pc.green(`\n✓ Validated ${tests.length} test(s)`));
        for (const { test, filePath } of tests) {
          log(`  - ${test.name} (${filePath})`);
        }
      }
      process.exit(0);
    }

    // Execute tests
    log('');
    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;

    for (const { test, filePath } of tests) {
      log(pc.cyan(`Running: ${test.name}`));
      if (verbose) {
        log(pc.dim(`  File: ${filePath}`));
      }

      try {
        const result = await runTest({
          config: configResult.config,
          test,
          testFilePath: filePath,
          verbose: verbose && !jsonOutput,
          onLog: (msg) => log(pc.dim(msg)),
          onDebug: debugMode && !jsonOutput ? (msg) => log(pc.dim(msg)) : undefined,
          recordDir,
          replayDir,
        });

        results.push({ ...result, filePath } as TestResult & { filePath: string });

        if (result.passed) {
          passed++;
          log(pc.green(`  ✓ PASS`), pc.dim(`(${result.testData.endTs - result.testData.startTs}ms)`));
        } else {
          failed++;
          log(pc.red(`  ✗ FAIL`));
          if (result.error) {
            log(pc.red(`    ${result.error}`));
          }
          for (const failure of result.failures) {
            log(pc.red(`    - ${failure}`));
          }
        }
      } catch (err) {
        failed++;
        results.push({
          testName: test.name,
          passed: false,
          error: (err as Error).message,
          failures: [(err as Error).message],
          filePath,
        } as TestResult & { filePath: string });
        log(pc.red(`  ✗ ERROR: ${(err as Error).message}`));
      }
      log('');
    }

    // Output results
    if (jsonOutput) {
      const jsonResults = results.map((r: TestResult & { filePath?: string }) => ({
        name: r.testName,
        file: r.filePath,
        passed: r.passed,
        duration: r.testData ? r.testData.endTs - r.testData.startTs : null,
        error: r.error,
        failures: r.failures.length > 0 ? r.failures : undefined,
      }));
      console.log(JSON.stringify({
        tests: jsonResults,
        passed,
        failed,
        total: passed + failed,
      }, null, 2));
    } else {
      // Summary
      log(pc.bold('─'.repeat(40)));
      log(
        pc.bold('Results:'),
        pc.green(`${passed} passed`),
        failed > 0 ? pc.red(`${failed} failed`) : pc.dim('0 failed')
      );
    }

    process.exit(failed > 0 ? 1 : 0);
  });
