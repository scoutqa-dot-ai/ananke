# ananke

Assertion-based testing tool for AG-UI applications.

## Features

- Run scripted multi-turn conversations against AG-UI endpoints
- Observe tool calls and assistant responses
- Evaluate deterministic assertions (no LLM-as-judge)
- CI-friendly with exit codes and JSON output

## Installation

```bash
npm install -g @scoutqa/ananke
```

Or run directly with npx:

```bash
npx @scoutqa/ananke run
```

## Quick Start

### 1. Create a config file

Create `ananke.config.yaml` in your project root:

```yaml
version: "1.0"

target:
  type: agui
  endpoint: "https://your-app.com/ag-ui"
  agentId: "my-agent"
  headers:
    Authorization: "Bearer ${ENV.AGUI_TOKEN}"
```

### 2. Write a test file

Create `tests/example.test.yaml`:

```yaml
version: "1.0"

name: basic conversation

turns:
  - user: "Hello, can you help me?"
    assert:
      text:
        matches: "help|assist"

  - user: "What's 2 + 2?"
    assert:
      text:
        matches: "4"
```

### 3. Run tests

```bash
ananke run
```

## CLI Usage

```
Usage: ananke run [options] [patterns...]

Run test files

Arguments:
  patterns             Test file patterns (glob)

Options:
  -c, --config <path>  Path to config file
  -d, --dry-run        Validate tests without executing
  --json               Output results as JSON
  -h, --help           display help for command
```

## Environment Variables

| Variable               | Description                                   | Default |
| ---------------------- | --------------------------------------------- | ------- |
| `ANANKE_LOG_LEVEL`     | Log level: `silent`, `info`, `debug`, `trace` | `info`  |
| `ANANKE_LOG_TIMESTAMP` | Show timestamps in log output: `1` to enable  | _(off)_ |

## Configuration

### Project Config (`ananke.config.yaml`)

```yaml
version: "1.0"

target:
  type: agui
  endpoint: "https://app.example.com/ag-ui"
  agentId: "my-agent"
  headers:
    Authorization: "Bearer ${ENV.AGUI_TOKEN}"
    X-Custom-Header: "value"
  # Optional: default assertions for all tests
  assert:
    response:
      having:
        durationMs: { max: 60000 }
    text:
      not:
        matches: ["exception", "fatal"]
```

Variables:

- `${ENV.NAME}` - Environment variable
- `${VAR.NAME}` - Variable from hooks or script turns

## Test File Format

```yaml
version: "1.0"

name: test name

hooks: # Optional setup scripts
  - cmd: ["bash", "scripts/setup.sh"]
    timeout_ms: 10000

turns:
  - user: "User message"
    assert: # Turn-level assertions (inherits from target and test)
      tool_names:
        some: { equals: "tool_name" }
        none: { equals: "forbidden_tool" }
      tools:
        some:
          having:
            name: { equals: "tool_name" }
            args.arg_name: { matches: "regex" }
      response:
        having:
          durationMs: { max: 30000 }
      text:
        matches: "regex"
        not:
          matches: ["error", "failed"]

assert: # Test-level assertions (inherits from target)
  tool_names:
    none: { equals: "dangerous_tool" }
  response:
    having:
      durationMs: { max: 120000 }
      idleMs: { max: 60000 }
```

## Assertions

See [docs/assertions-v2.md](docs/assertions-v2.md) for the full assertion reference.

### Selectors

| Selector     | Type   | Description                                         |
| ------------ | ------ | --------------------------------------------------- |
| `text`       | string | Assistant response text                             |
| `tool_names` | array  | Tool call names                                     |
| `tools`      | array  | Full tool call objects                              |
| `response`   | object | Response metrics (use `having` to assert on fields) |

### Common Operators

| Operator                | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `equals`                | Exact match (string, number, boolean, null)           |
| `contains`              | Substring (string) or element membership (array)      |
| `matches`               | Regex pattern(s) that must all match                  |
| `min`, `max`            | Number comparisons                                    |
| `count`                 | Number assertion on array length                      |
| `some`, `every`, `none` | Element-level array assertions                        |
| `ordered`               | Elements appear in order                              |
| `filter`                | Keep matching elements, assert on sub-array           |
| `having`                | Dot-path shorthand for object field assertions        |
| `json`                  | Parse JSON string (or pass through pre-parsed values) |
| `and`, `or`, `not`      | Logical combinators                                   |

## Hooks

Hooks run before test execution. They must output JSON to stdout with a `variables` key:

```bash
#!/bin/bash
echo '{"variables": {"THREAD_ID": "th_123", "USER_ID": "user_456"}}'
```

Variables from hooks are available as `${VAR.NAME}` in turns and config:

```yaml
turns:
  - user: "Check thread ${VAR.THREAD_ID}"
```

## Script Turns

Script turns dynamically generate user messages based on previous turn data:

```yaml
turns:
  - user: "Show shipping options"
    assert:
      tool_names:
        some: { equals: "get_shipping_options" }

  - type: script
    script: "scripts/pick-cheapest.sh"
    assert:
      tool_names:
        some: { equals: "calculate_total" }
```

Scripts receive an `ANANKE` env var (and stdin) with JSON containing `value`, `turns`, `variables`, and `turnIndex`. They output JSON with `message` (required), `variables` (optional), and `action` (optional).

See [docs/unified-script-contract.md](docs/unified-script-contract.md) for the full script contract.

## CI Integration

### GitHub Actions

```yaml
- name: Run AG-UI tests
  run: npx @scoutqa/ananke run --json > results.json
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
