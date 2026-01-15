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

## Project-Level Configuration

Protocol configuration is defined once per project, not per test.

### Project config file

Default: `aguitest.config.yaml` at repo root.

```yaml
target:
  endpoint: "https://app.example.com/ag-ui"
  headers:
    Authorization: "Bearer ${ENV.AGUI_TOKEN}"
    X-Test-Client: "agui-test/0.1"
```

- Headers are the only auth mechanism in MVP.
- Anything more complex must be handled via hooks/scripts.

---

## Preflight Hooks (Setup Scripts)

Tests may require front-running setup (REST calls, seeding, auth).

Hooks are defined per test YAML and are executed before any turns.

- Hooks are generic executable commands
- Stdout must be valid JSON
- Parsed JSON is merged into the variable map
- Failure ⇒ FAIL immediately

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
3. Open AG-UI SSE connection using interpolated `target.endpoint` and `target.headers`
4. Execute all turns sequentially:

   1. Send user message
   2. Collect artifacts for the turn:

      - all tool calls emitted before the final assistant message
      - final assistant text

   3. Evaluate turn-level assertions (if any)
      - On failure → FAIL immediately

5. After all turns complete, evaluate test-level assertions

   - Test-level assertions have access to data aggregated from all turns

6. If all assertions pass → PASS

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

### Where assertions can live

- Turn-level assertions
  - Defined under a specific turn
  - Evaluated immediately after that turn
  - Have access only to that turn's data
- Test-level assertions
  - Defined at the root of the YAML
  - Evaluated once, after all turns
  - Have access to data from all turns

Turn-level failure ⇒ immediate FAIL.
Test-level failure ⇒ FAIL after all turns complete.

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

- `after: <tool_name>` — this tool must be called after at least one call to `<tool_name>`

---

### 4) Timing Assertions

Timing constraints can be applied at turn or test level:

- `max_duration_ms`: maximum allowed duration
- `max_gap_ms`: maximum idle gap between consecutive tool calls

---

### 5) Text Constraints (Secondary, Regex-only)

- Must match regex
- Must not match regex

No semantic interpretation. No refusal classification section.

---

## Assertion Semantics

- Missing arguments in `args_match` ⇒ non-match
- Missing result fields ⇒ `result_match` fails, `result_not_match` passes
- Regex matching follows RE2 / engine-default rules
- All assertions are ANDed (no OR / boolean logic)
- Timing assertions use Unix millisecond timestamps from SSE events

---

## YAML Shape

### Project config (once per repo)

See above.

---

### Test file

```yaml
name: <string>

hooks: # optional
  - cmd: ["bash", "scripts/setup.sh"]

turns:
  - user: <string>
    assert: <AssertBlock | {} optional> # TURN-LEVEL assertions

  - user: <string> # optional
    assert: <AssertBlock | {} optional>

assert: <AssertBlock | {} optional> # TEST-LEVEL assertions
```

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
      result_match: <regex> # result must match
      result_not_match: <regex> # result must NOT match
      after: <tool_name> # ordering: must come after this tool

  forbid_calls:
    - name: <tool_name>
      args_match:
        <arg_key>: <regex>
      result_match: <regex> # forbid if result matches

timing:
  max_duration_ms: <number> # max total duration for scope (turn/test)
  max_gap_ms: <number> # max idle gap between tool calls

text:
  must_match: <regex>
  must_not_match: <regex>
```

---

## Example: Full Test File

```yaml
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
            after: validate_cart # must come after validate_cart
      timing:
        max_duration_ms: 30000

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

assert: # test-level
  tools:
    forbid:
      - delete_order
  timing:
    max_duration_ms: 120000
    max_gap_ms: 60000
```
