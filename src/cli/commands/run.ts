import { mkdir, writeFile } from 'node:fs/promises';
import { relative, join } from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import {
  loadConfig,
  loadTestFile,
  findTestFiles,
  DEFAULT_TEST_PATTERNS,
} from '../../config/index.js';
import { runTest, type TestResult } from '../../runner/index.js';
import { getTestRecordingDir } from '../../recording/index.js';
import { formatDuration } from '../../runner/format.js';
import { createLogger } from '../../logger.js';

export interface RunOptions {
  config?: string;
  dryRun?: boolean;
  json?: boolean;
  report?: string;
  replay?: string;
}

export const runCommand = new Command('run')
  .description('Run test files')
  .argument('[patterns...]', 'Test file patterns (glob)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-d, --dry-run', 'Validate tests without executing')
  .option('--json', 'Output results as JSON')
  .option('--report <dir>', 'Record events and write report to directory')
  .option('--replay <dir>', 'Replay events from directory')
  .action(async (patterns: string[], options: RunOptions) => {
    const jsonOutput = options.json ?? false;
    const reportDir = options.report;
    const replayDir = options.replay;

    // Create logger from ANANKE_LOG_LEVEL env var (default: info)
    const logger = createLogger({ json: jsonOutput });

    // Validate mutually exclusive options
    if (reportDir && replayDir) {
      console.error(pc.red('Error: --report and --replay are mutually exclusive'));
      process.exit(1);
    }

    // Helper for conditional console output (suppressed in JSON mode)
    const log = jsonOutput ? () => {} : console.log;
    const logError = jsonOutput ? () => {} : console.error;

    // Load project config
    logger.debug('Loading config...');

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

    logger.debug(`Config loaded from: ${configResult.configPath}`);
    logger.debug(`Endpoint: ${configResult.config.target.endpoint}`);

    // Find test files
    const testPatterns =
      patterns.length > 0 ? patterns : DEFAULT_TEST_PATTERNS;
    const cwd = process.cwd();

    logger.debug(`Finding tests with patterns: ${testPatterns.join(', ')}`);

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
        logger.debug(`  ✓ ${filePath} (${test.steps.length} steps)`);
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
      logger.debug(`  File: ${filePath}`);

      try {
        const result = await runTest({
          config: configResult.config,
          test,
          testFilePath: filePath,
          logger,
          reportDir,
          replayDir,
        });

        // Write report.json to per-test directory
        if (reportDir) {
          const relPath = relative(process.cwd(), filePath);
          const testDir = getTestRecordingDir(reportDir, relPath);
          await mkdir(testDir, { recursive: true });
          await writeFile(
            join(testDir, 'report.json'),
            JSON.stringify(result, null, 2) + '\n',
          );
        }

        results.push({ ...result, filePath } as TestResult & { filePath: string });

        if (result.passed) {
          passed++;
          log(pc.green(`  ✓ PASS`), pc.dim(`(${formatDuration(result.testData.endTs - result.testData.startTs)})`));
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
