# Report

`--report <dir>` records protocol events and writes a `report.json` per test. Use `--replay <dir>` to re-run assertions against saved events without hitting the remote server.

## Usage

```bash
# Run tests, write events + report
ananke run --report ./reports/

# Replay from saved events (no remote calls)
ananke run --replay ./reports/
```

`--report` and `--replay` are mutually exclusive.

## Directory Structure

```
reports/
  tests/
    v0-login-form-app.test.yaml/
      report.json
      step-0.jsonl
      step-1.jsonl
    other/
      nested.test.yaml/
        report.json
        step-0.jsonl
```

- `report.json` — the full `TestResult` object, straight `JSON.stringify`
- `step-N.jsonl` — protocol events for agent-facing step N (one event per line)

## report.json

A direct dump of `TestResult`:

```typescript
interface TestResult {
  testName: string;
  passed: boolean;
  skipped?: boolean;
  testData: TestData;
  error?: string;
  failures: string[];
}

interface TestData {
  steps: StepData[];
  allToolCalls: ToolCall[];
  allAssistantTexts: string[];
  startTs: number;
  endTs: number;
}

interface StepData {
  stepIndex: number;
  type: "message" | "resume" | "script";
  toolCalls: ToolCall[];
  assistantText: string;
  startTs: number;
  endTs: number;
  timings: StepTimings;
  assertions?: StepAssertionResult;
  exitCode?: number; // script steps only (non-zero = test skipped)
}
```

## Replay

During replay, agent-facing steps (message/resume) read events from JSONL files instead of calling the remote server. Script steps are always re-executed to restore variables.

Test file paths are used as directory names, mirroring the source layout.
