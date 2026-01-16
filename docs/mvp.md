# AG-UI Testing MVP

## What This Product Is

An assertion-based testing tool for tool-using AI apps that:

- Runs scripted user-only multi-turn conversations
- Connects to an app via AG-UI over SSE
- Observes:
  - tool calls (name + normalized args + result + timing)
  - assistant text
- Evaluates hard assertions
- Produces a binary PASS / FAIL result for CI

No LLM-as-judge (yet).

---

## Core Principles

- Tools are the primary oracle
- Text is secondary, regex-based
- Fail fast on turn-level violations
- Deterministic CI semantics
- Single execution model

---

## Target User (MVP)

- Developers building AG-UI / tool-using AI apps
- Running tests locally and in CI
- Dogfooding their own applications

Out of scope: non-dev users, semantic "answer quality" evaluation.

---

## MVP Connectivity

### Protocol

- AG-UI over SSE only

Future (out of scope): MCP, A2A adapters.

---

## Schema Versioning

All configuration and test files include a `version` field for schema evolution.

### Version Format

```
MAJOR.MINOR
```

- **MAJOR**: Breaking changes (removed fields, changed semantics)
- **MINOR**: Additive changes (new protocols, new assertion types, new optional fields)

### Version History

| Version | Changes                           |
| ------- | --------------------------------- |
| `1.0`   | Initial schema with AG-UI support |
| `1.1`   | _(planned)_ A2A protocol support  |
| `1.2`   | _(planned)_ MCP protocol support  |

---

## Project-Level Configuration

Protocol configuration is defined once per project, not per test.

### Project config file

Default: `ananke.config.yaml` at repo root.

```yaml
version: "1.0"

target:
  type: agui # Discriminator

  # Common fields (all protocols)
  headers:
    Authorization: "Bearer ${ENV.AGUI_TOKEN}"
    X-Test-Client: "ananke/0.1"
  timeout_ms: 30000

  # Default assertions for all tests
  assert:
    timing:
      max_duration_ms: 60000
      max_idle_ms: 10000
    text:
      must_not_match: ["exception", "fatal"]

  # AG-UI specific fields (flat, same level as type)
  endpoint: "https://app.example.com/ag-ui"
  agentId: "my-agent"
  threadId: "${THREAD_ID}" # Optional, auto-generated if omitted
  forwardedProps: # Optional
    customField: "value"
  state: # Optional
    key: "value"
```

### Protocol-Specific Configuration

The `target.type` field determines which fields are valid. All fields are at the same level (flat discriminated union).

#### AG-UI (`type: agui`)

```yaml
target:
  type: agui
  # Common
  headers?: Record<string, string>
  timeout_ms?: number
  assert?: # Default assertions for all tests
    tools?: { forbid?, require?, forbid_calls? }
    timing?: { max_duration_ms?, max_idle_ms? }
    text?: { must_match?, must_not_match? }
  # AG-UI specific
  endpoint: string # Required: AG-UI endpoint URL
  agentId: string # Required: Agent identifier
  threadId?: string # Optional: Thread ID (auto-generated if omitted)
  forwardedProps?: object # Optional: Custom props forwarded to agent
  state?: object # Optional: Initial state
```

#### A2A (`type: a2a`) - Future

```yaml
target:
  type: a2a
  # Common
  headers?: Record<string, string>
  timeout_ms?: number
  assert?: AssertBlock # Default assertions
  # A2A specific - Discovery (one required)
  agentCardUrl?: string # Fetch Agent Card from URL
  agentCard?: object # Inline Agent Card
  endpoint?: string # Direct endpoint (skip discovery)
  # A2A specific - Session
  contextId?: string # Conversation grouping
  # A2A specific - Options
  blocking?: boolean # Wait for task completion
  acceptedOutputModes?: string[]
  # A2A specific - Auth
  auth?:
    scheme: apiKey | bearer | oauth2 | mtls
    # Scheme-specific fields vary
```

#### MCP (`type: mcp`) - Future

```yaml
target:
  type: mcp
  # Common
  headers?: Record<string, string>
  timeout_ms?: number
  assert?: AssertBlock # Default assertions
  # MCP specific
  transport: stdio | sse # Required: Transport type
  command?: string[] # For stdio: command to spawn
  endpoint?: string # For sse: HTTP endpoint
  env?: object # Environment variables for subprocess
```

---

## Preflight Hooks (Setup Scripts)

Tests may require front-running setup (REST calls, seeding, auth).

Hooks are defined per test YAML and are executed before any turns.

- Hooks are generic executable commands
- Stdout must be valid JSON
- Parsed JSON is merged into the variable map
- Failure => FAIL immediately

There is no built-in notion of `beforeAll` / `beforeEach`.
If shared setup is required, reference the same hook path from multiple test files.

### Hook contract

```yaml
hooks:
  - cmd: ["bash", "scripts/setup.sh"]
    timeout_ms: 15000
```

Stdout example:

```json
{ "THREAD_ID": "th_123" }
```

Variables are accessible as `${VAR}`.
Environment variables are accessible as `${ENV.NAME}`.

---

## Execution Model

For each test file:

1. Load project config
2. Execute test hooks and collect variables
3. Create protocol client based on `target.type`
4. Execute all turns sequentially:

   1. Send user message (or execute turn action based on turn type)
   2. Collect artifacts for the turn:

      - all tool calls emitted before the final assistant message
      - final assistant text

   3. Evaluate turn-level assertions (if any)
      - On failure -> FAIL immediately

5. After all turns complete, evaluate test-level assertions

   - Test-level assertions have access to data aggregated from all turns

6. If all assertions pass -> PASS

---

## Captured Data Model

### Per-turn data

For each turn, record:

- ordered list of tool calls:
  - `name`
  - normalized `args`
  - `result` (tool output, may be object or string)
  - `timestamp` (Unix ms when tool call completed)
- assistant text
- `turn_start_ts` / `turn_end_ts` (Unix ms)

### Aggregated test data

Test-level assertions receive:

- all tool calls across all turns (with ordering preserved)
- all assistant texts across all turns
- per-turn boundaries (turn index preserved)
- `test_start_ts` / `test_end_ts` (Unix ms)

---

## Assertions

Assertions are pure, deterministic checks over captured data.

### Three-Level Inheritance

Assertions can be defined at three levels with inheritance:

```
target (config) -> test -> turn
```

| Level  | Location                  | Scope       | Evaluation               |
| ------ | ------------------------- | ----------- | ------------------------ |
| Target | `target.assert` in config | All tests   | Defaults for every test  |
| Test   | `assert` at test root     | Single test | After all turns complete |
| Turn   | `assert` under turn       | Single turn | Immediately after turn   |

### Merge Semantics

- **Scalars** (numbers): Higher level overrides lower
- **`false`**: Disables the inherited constraint
- **Arrays** (`forbid`, `require`, `must_match`): Extend (accumulate from all levels)

### Example

```yaml
# ananke.config.yaml
target:
  type: agui
  endpoint: "..."
  assert: # Target-level defaults
    tools:
      forbid: [dangerous_tool]
    timing:
      max_duration_ms: 60000
    text:
      must_not_match: ["exception"]

# test.yaml
assert: # Test-level (extends target)
  tools:
    forbid: [test_forbidden] # Accumulated: [dangerous_tool, test_forbidden]
  timing:
    max_duration_ms: 120000 # Override: 120s
  text:
    must_not_match: ["error"] # Accumulated: ["exception", "error"]

turns:
  - user: "slow operation"
    assert: # Turn-level (extends test)
      timing:
        max_duration_ms: 300000 # Override for this turn
        max_idle_ms: false # Disable idle check
```

### Evaluation

- Turn-level failure => immediate FAIL
- Test-level failure => FAIL after all turns complete

---

## What You Can Assert (MVP)

### 1) Tool Behavior (Primary)

- Forbidden tools must never be called
- Required tools must be called
- Call counts:
  - exact
  - min / max
- Partial argument must match / not match regex
- Forbidden tool calls when args match a pattern
- Tool result assertions (regex on result content)
- Tool ordering constraints (`after` clause)

Examples:

- "`charge_card` must be called exactly once in the whole test"
- "`search_inventory` must be called before `checkout`"
- "`report_issue` result must not match `Ref .* not found`"

---

### 2) Tool Result Assertions

Tool results can be asserted similarly to arguments:

- `result_match`: regex that must match somewhere in the result
- `result_not_match`: regex that must NOT match in the result

Result matching operates on the JSON-stringified result for objects,
or the raw string for string results.

---

### 3) Tool Ordering Assertions

Tools can declare ordering dependencies:

- `after: <tool_name>` -- this tool must be called after at least one call to `<tool_name>`

---

### 4) Timing Assertions

- `max_duration_ms`: maximum total duration for the scope
- `max_idle_ms`: maximum idle time (gaps with no tool activity)
  - Includes: start-to-first-tool, between-tools, last-tool-to-end

---

### 5) Text Constraints (Secondary, Regex-only)

- `must_match`: array of regexes that must all match
- `must_not_match`: array of regexes that must not match

No semantic interpretation. No refusal classification section.

---

## Assertion Semantics

- Missing arguments in `args_match` => non-match
- Missing result fields => `result_match` fails, `result_not_match` passes
- Regex matching follows RE2 / engine-default rules
- All assertions are ANDed (no OR / boolean logic)
- Timing assertions use Unix millisecond timestamps from SSE events

---

## YAML Shape

### Project config (once per repo)

```yaml
version: "1.0"

target:
  type: agui
  # Common fields
  headers:
    <header_name>: <header_value>
  timeout_ms: <number>
  assert: <AssertBlock> # Default assertions for all tests
  # AG-UI fields (flat)
  endpoint: <string>
  agentId: <string>
  threadId: <string>
  forwardedProps: <object>
  state: <object>
```

---

### Test file

```yaml
version: "1.0"

name: <string>

hooks: # optional
  - cmd: ["bash", "scripts/setup.sh"]

turns:
  - type: user # Optional, default is "user"
    user: <string>
    assert: <AssertBlock> # Turn-level assertions

  - type: agui:connect # AG-UI specific turn type
    assert: <AssertBlock>

assert: <AssertBlock> # Test-level assertions
```

### Turn Types

Turn types use a `type` discriminator for extensibility:

| Type           | Protocol | Description                                |
| -------------- | -------- | ------------------------------------------ |
| `user`         | All      | Send user message (default)                |
| `agui:connect` | AG-UI    | Connect to existing thread without message |
| `a2a:send`     | A2A      | _(future)_ Send A2A task                   |
| `mcp:call`     | MCP      | _(future)_ Call MCP tool directly          |

---

## AssertBlock

```yaml
tools:
  forbid: [<tool_name>...]

  require:
    - name: <tool_name>
      count: { exact: 1 } # or { min: 1, max: 3 }
      args_match:
        <arg_key>: <regex>
      result_match: <regex>
      result_not_match: <regex>
      after: <tool_name>

  forbid_calls:
    - name: <tool_name>
      args_match:
        <arg_key>: <regex>
      result_match: <regex>

timing:
  max_duration_ms: <number | false> # false to disable inherited
  max_idle_ms: <number | false>

text:
  must_match: [<regex>, ...] # Array of regexes (all must match)
  must_not_match: [<regex>, ...] # Array of regexes (none must match)
```

Note: `text.must_match` and `text.must_not_match` accept both single string and array formats.

---

## Example: Full Test File

```yaml
version: "1.0"

name: checkout flow with validation

hooks:
  - cmd: ["bash", "scripts/seed-cart.sh"]
    timeout_ms: 10000

turns:
  - user: "I want to checkout"
    assert:
      tools:
        require:
          - name: validate_cart
          - name: get_shipping_options
            after: validate_cart
      timing:
        max_duration_ms: 30000 # Turn-level override

  - user: "Use the first shipping option"
    assert:
      tools:
        require:
          - name: calculate_total
            result_not_match: "error|failed"

  - user: "Confirm and pay"
    assert:
      tools:
        require:
          - name: charge_card
            count: { exact: 1 }
        forbid_calls:
          - name: charge_card
            result_match: "declined|insufficient"
      timing:
        max_idle_ms: false # Disable inherited idle check

assert: # Test-level assertions (extends target)
  tools:
    forbid:
      - delete_order
  timing:
    max_duration_ms: 120000 # Override target's 60000
    max_idle_ms: 60000
  text:
    must_not_match:
      - "error"
      - "failed"
```

---

## Future Work

### Protocol Adapters

- **A2A** (`type: a2a`) - Agent-to-Agent protocol support
- **MCP** (`type: mcp`) - Model Context Protocol support

### Reusable Assertion Blocks (`extends` / `$ref`)

Allow tests to reference shared assertion definitions to reduce duplication:

```yaml
# ananke.config.yaml
assertions:
  no_errors:
    text:
      must_not_match: ["error", "failed", "exception"]
  fast_response:
    timing:
      max_duration_ms: 5000

# test.yaml
turns:
  - user: "checkout"
    assert:
      extends: [no_errors, fast_response] # Reuse common assertions
      tools:
        require:
          - name: charge_card
```

This would enable DRY assertion patterns across multiple test files.
