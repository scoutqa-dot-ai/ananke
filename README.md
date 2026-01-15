# ispeakai

Assertion-based testing tool for AG-UI applications.

## Features

- Run scripted multi-turn conversations against AG-UI endpoints
- Observe tool calls and assistant responses
- Evaluate deterministic assertions (no LLM-as-judge)
- CI-friendly with exit codes and JSON output

## Installation

```bash
npm install -g ispeakai
```

Or run directly with npx:

```bash
npx ispeakai run
```

## Quick Start

### 1. Create a config file

Create `ispeakai.config.yaml` in your project root:

```yaml
target:
  endpoint: "https://your-app.com/ag-ui"
  headers:
    Authorization: "Bearer ${ENV.AGUI_TOKEN}"
```

### 2. Write a test file

Create `tests/example.test.yaml`:

```yaml
name: basic conversation

turns:
  - user: "Hello, can you help me?"
    assert:
      text:
        must_match: "help|assist"

  - user: "What's 2 + 2?"
    assert:
      text:
        must_match: "4"
```

### 3. Run tests

```bash
ispeakai run
```

## CLI Usage

```
Usage: ispeakai run [options] [patterns...]

Run test files

Arguments:
  patterns             Test file patterns (glob)

Options:
  -c, --config <path>  Path to config file
  -v, --verbose        Verbose output
  -d, --dry-run        Validate tests without executing
  --json               Output results as JSON
  -h, --help           display help for command
```

## Configuration

### Project Config (`ispeakai.config.yaml`)

```yaml
target:
  endpoint: "https://app.example.com/ag-ui"
  headers:
    Authorization: "Bearer ${ENV.AGUI_TOKEN}"
    X-Custom-Header: "value"
  agentId: "my-agent"  # Optional, for CopilotKit transport
```

Variables:
- `${ENV.NAME}` - Environment variable
- `${VAR}` - Variable from hooks

## Test File Format

```yaml
name: test name

hooks:  # Optional setup scripts
  - cmd: ["bash", "scripts/setup.sh"]
    timeout_ms: 10000

turns:
  - user: "User message"
    assert:  # Turn-level assertions
      tools:
        require:
          - name: tool_name
            count: { exact: 1 }
            args_match:
              arg_name: "regex"
            result_match: "regex"
            after: other_tool
        forbid:
          - forbidden_tool
      timing:
        max_duration_ms: 30000
      text:
        must_match: "regex"
        must_not_match: "error"

assert:  # Test-level assertions (after all turns)
  tools:
    forbid:
      - dangerous_tool
  timing:
    max_duration_ms: 120000
    max_gap_ms: 60000
```

## Assertions

### Tool Assertions

| Assertion | Description |
|-----------|-------------|
| `forbid` | List of tools that must not be called |
| `require.name` | Tool must be called |
| `require.count` | `{ exact: N }` or `{ min: N, max: N }` |
| `require.args_match` | Regex patterns for arguments |
| `require.result_match` | Regex that must match result |
| `require.result_not_match` | Regex that must NOT match result |
| `require.after` | Tool must be called after another tool |
| `forbid_calls` | Forbid calls matching args/result patterns |

### Timing Assertions

| Assertion | Description |
|-----------|-------------|
| `max_duration_ms` | Maximum duration for turn/test |
| `max_gap_ms` | Maximum gap between tool calls |

### Text Assertions

| Assertion | Description |
|-----------|-------------|
| `must_match` | Regex that must match assistant text |
| `must_not_match` | Regex that must NOT match |

## Hooks

Hooks run before test execution. They must output JSON to stdout:

```bash
#!/bin/bash
echo '{"THREAD_ID": "th_123", "USER_ID": "user_456"}'
```

Variables from hooks are available as `${VAR}` in the test.

## CI Integration

### GitHub Actions

```yaml
- name: Run AG-UI tests
  run: npx ispeakai run --json > results.json
  env:
    AGUI_TOKEN: ${{ secrets.AGUI_TOKEN }}

- name: Upload results
  uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: results.json
```

### Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed

## License

MIT
