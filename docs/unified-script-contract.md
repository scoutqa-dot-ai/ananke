# Unified Script Contract

> **Status:** Implemented

## Overview

Scripts appear in two places in ananke: **script steps** (variable setup / environment preparation) and **script assertions** (custom evaluation). This document defines the single, consistent contract for all scripts.

A unified contract means one shape to learn, one set of env vars, and consistent behavior everywhere.

---

## YAML Shape

Same everywhere — short form (string) or long form (object):

```yaml
# Short form
script: "scripts/do-thing.sh"

# Long form
script:
  run: "scripts/do-thing.sh"
  timeout_ms: 10000
  env:
    KEY: "value"
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `run` | string | yes | — | Command or script path (resolved relative to project root) |
| `timeout_ms` | number | no | `10000` | Max execution time in ms |
| `env` | object | no | `{}` | Additional environment variables (supports `${VAR.X}` / `${ENV.X}` interpolation) |

Short form `script: "cmd"` is sugar for `script: { run: "cmd" }`.

---

## Input: `ANANKE` Environment Variable

Every script receives a single env var `ANANKE` containing a JSON object with a consistent shape:

```json
{
  "value": null,
  "turns": [],
  "variables": {},
  "turnIndex": null
}
```

| Field | Type | Description |
|---|---|---|
| `value` | `any \| null` | Primary input value — the asserted value for assertions, `null` otherwise |
| `turns` | `TurnData[]` | All completed turns so far (only agent-facing steps produce turns) |
| `variables` | `Record<string, string>` | Current variable map |
| `turnIndex` | `number \| null` | Current turn index, `null` for script steps and test-level assertions |

**stdin** receives the same JSON as `ANANKE`.

### What each script location sees

| Location | `value` | `turns` | `variables` | `turnIndex` |
|---|---|---|---|---|
| **Script step** | `null` | completed turns | accumulated from prior steps | `null` |
| **Assertion (turn)** | the asserted value | completed turns | all vars | current index |
| **Assertion (test)** | the asserted value | all turns | all vars | `null` |

The `env` field in the long form adds extra env vars on top of `ANANKE`. These are for convenience — passing small values without parsing JSON.

---

## Output: stdout as JSON

Every script outputs a JSON object to stdout. All fields are optional:

```json
{
  "variables": { "TOKEN": "abc", "ORDER_ID": "ord_456" },
  "reason": "User record found in database"
}
```

| Field | Type | Used by | Description |
|---|---|---|---|
| `variables` | `Record<string, string>` | All | Merged into the variable map for subsequent interpolation |
| `reason` | `string` | Assertion | Debug info captured in test output (for both pass and fail) |

### What each location uses

| Location | `variables` | `reason` |
|---|---|---|
| **Script step** | Merged into variable map | ignored |
| **Assertion** | Merged into variable map | Captured in assertion result for debugging |

Empty stdout or `{}` is valid — no variables set, no reason.

### Error: non-JSON stdout

If stdout is not valid JSON and exit code is 0, the script fails with a parse error. This is consistent — all scripts speak JSON.

---

## Exit Codes

| Code | Meaning |
|---|---|
| **0** | Success — parse stdout as JSON |
| **non-zero** | Failure — stderr is captured as the error reason |

Exit codes are simple: 0 or not-0. All skip/control logic is handled via the `action` field in stdout JSON (see below).

---

## Action Field

The `action` field in stdout JSON controls execution flow. When absent, the default behavior applies (set variables, etc.).

| Action | Description |
|---|---|
| `"skip_step"` | Skip this step. No variables set. Execution continues to the next step. |
| `"skip_test"` | Stop the entire test with a **SKIP** result (not PASS, not FAIL). No subsequent steps execute. |
| `"skip_assertion"` | Skip this assertion (vacuous pass). Other assertions and steps continue. |

### Which actions are valid where

| Location | Valid actions | Default (no action) |
|---|---|---|
| **Script step** | `skip_step`, `skip_test` | Set variables |
| **Assertion** | `skip_assertion`, `skip_test` | Pass/fail based on exit code |

Using an invalid action for the location (e.g., `skip_assertion` in a script step) produces an error.

### Examples

```bash
# Skip this step — continue to next
echo '{"action": "skip_step"}'
exit 0

# Skip the entire test — preconditions not met
echo '{"action": "skip_test"}'
exit 0

# Normal execution — set variables
echo '{"variables": {"THREAD_ID": "th_123", "TOKEN": "abc"}}'
exit 0

# Conditional setup — skip if env not available
if [ -z "$COUPON" ]; then
  echo '{"action": "skip_step"}'
else
  echo '{"variables": {"HAS_COUPON": "true", "COUPON_CODE": "'"$COUPON"'"}}'
fi
exit 0
```

---

## Variable Namespacing

Variables from scripts are referenced with the `VAR.` prefix:

```
${VAR.NAME}   ← script variables (from script steps, assertion scripts)
${ENV.NAME}   ← environment variables (process.env)
```

### Variable accumulation

Variables accumulate throughout test execution. Each script's `variables` output is merged into the map, and subsequent scripts/steps can reference them:

```
step 1 (script) → {"variables": {"THREAD_ID": "th_123"}}
step 2 (script) → can use ${VAR.THREAD_ID}, outputs {"variables": {"TOKEN": "abc"}}
step 3 (user)   → user: "Check ${VAR.THREAD_ID}" → sends "Check th_123"
step 4 (script) → receives variables: {THREAD_ID: "th_123", TOKEN: "abc"}
                   outputs {"variables": {"ORDER_ID": "ord_1"}}
step 5 (user)   → user: "Status of ${VAR.ORDER_ID}" → sends "Status of ord_1"
```

Variables set by assertion scripts are also available to subsequent steps and assertions within the same test.

---

## Steps

A test file contains an ordered list of **steps**. Each step is one of three types:

### User step — sends a message to the agent

```yaml
steps:
  - user: "Show me shipping options for cart ${VAR.CART_ID}"
    assert:
      tool_names:
        some: { equals: "get_shipping_options" }
```

The `user` field is interpolated with `${VAR.X}` and `${ENV.X}` before sending. Assertions evaluate on the agent's response.

### Script step — runs a script, sets variables

```yaml
steps:
  - type: script
    script: "scripts/seed-cart.sh"
    # stdout: {"variables": {"CART_ID": "cart_789"}}

  - type: script
    script:
      run: "scripts/pick-cheapest-option.sh"
      timeout_ms: 5000
      env:
        PREV_RESPONSE: "${VAR.LAST_TEXT}"
```

Script steps:
1. Run the script with `ANANKE` containing all completed turns and current variables
2. Parse stdout JSON and merge `variables` into the map
3. **Do not send any message to the agent**
4. **Do not take assertions** (no agent response to assert on)

This replaces the former "hooks" concept. Script steps at the beginning of a test serve the same purpose hooks did (setup, variable initialization), but are now just regular steps in the sequence.

### Connect step — observe an existing thread

```yaml
steps:
  - type: agui:connect
    assert:
      text:
        contains: "status"
```

Connects to an existing AG-UI thread without sending a message. Assertions evaluate on the observed response.

---

## Script Assertion

Script assertions use the unified contract to perform custom evaluation.

### Examples

```yaml
# Assertion with debug reason
steps:
  - user: "Create user John"
    assert:
      tools:
        some:
          having:
            name: { equals: "create_user" }
            result.json.user_id:
              script: "scripts/verify_user_exists.sh"
```

```bash
#!/bin/bash
# scripts/verify_user_exists.sh
USER_ID=$(echo "$ANANKE" | jq -r '.value')

if psql -v id="$USER_ID" -t -c "SELECT 1 FROM users WHERE id = :'id'" | grep -q 1; then
  echo '{"reason": "User found in database"}'
  exit 0
else
  echo '{"reason": "User not found in users table"}' >&2
  exit 1
fi
```

### Assertion with variable output

An assertion script can set variables for downstream use:

```yaml
steps:
  - user: "Create project Alpha"
    assert:
      tools:
        some:
          having:
            name: { equals: "create_project" }
            result.json.project_id:
              script: "scripts/verify_and_capture.sh"

  - user: "Add a task to project ${VAR.CREATED_PROJECT_ID}"
```

```bash
#!/bin/bash
# scripts/verify_and_capture.sh
PROJECT_ID=$(echo "$ANANKE" | jq -r '.value')

if psql -v id="$PROJECT_ID" -t -c "SELECT 1 FROM projects WHERE id = :'id'" | grep -q 1; then
  echo "{\"variables\": {\"CREATED_PROJECT_ID\": \"$PROJECT_ID\"}, \"reason\": \"Project verified\"}"
  exit 0
else
  echo '{"reason": "Project not found"}' >&2
  exit 1
fi
```

---

## TurnData Shape (for reference)

The `turns` array in the `ANANKE` input contains these objects (only agent-facing steps produce turns):

```typescript
interface TurnData {
  turnIndex: number;
  toolCalls: ToolCall[];
  assistantText: string;
  startTs: number;
  endTs: number;
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: number;
}
```

---

## Full Example

```yaml
version: "1.0"
name: dynamic checkout with coupon

steps:
  # Step 1: setup — seed cart via script
  - type: script
    script: "scripts/seed-cart.sh"
    # stdout: {"variables": {"CART_ID": "cart_789"}}

  # Step 2: user message using variable from setup
  - user: "Show shipping options for cart ${VAR.CART_ID}"
    assert:
      tool_names:
        some: { equals: "get_shipping_options" }

  # Step 3: script picks cheapest option from turn 1's response
  - type: script
    script: "scripts/pick-cheapest-option.sh"
    # stdout: {"variables": {"SHIPPING_OPTION": "Express"}}

  # Step 4: send the picked option
  - user: "Use shipping option: ${VAR.SHIPPING_OPTION}"
    assert:
      tool_names:
        some: { equals: "calculate_total" }

  # Step 5: script may skip if no coupon available
  - type: script
    script:
      run: "scripts/maybe-get-coupon.sh"
      env:
        COUPON: "${ENV.COUPON_CODE}"
    # stdout: {"variables": {"COUPON_MSG": "Apply coupon code ABC123"}}
    # or: {"action": "skip_step"}

  # Step 6: apply coupon (message comes from script variable)
  - user: "${VAR.COUPON_MSG}"
    assert:
      tool_names:
        some: { equals: "apply_coupon" }

  # Step 7: confirm and pay
  - user: "Confirm and pay for order ${VAR.ORDER_ID}"
    assert:
      tools:
        filter:
          having:
            name: { equals: "charge_card" }
        count: { equals: 1 }

assert:
  tools:
    none:
      having:
        name: { equals: "charge_card" }
        result.json: { has_key: "error" }
```

```bash
#!/bin/bash
# scripts/pick-cheapest-option.sh
CHEAPEST=$(echo "$ANANKE" | jq -r '
  .turns[-1].toolCalls[]
  | select(.name == "get_shipping_options")
  | .result | fromjson
  | .options | sort_by(.price)[0].name
')
echo "{\"variables\": {\"SHIPPING_OPTION\": \"$CHEAPEST\"}}"
```

```bash
#!/bin/bash
# scripts/maybe-get-coupon.sh
COUPON="$COUPON"  # from env field
if [ -z "$COUPON" ]; then
  echo '{"action": "skip_step"}'
  exit 0
fi
echo "{\"variables\": {\"COUPON_MSG\": \"Apply coupon code $COUPON\", \"HAS_COUPON\": \"true\"}}"
```

---

## Implementation

| File | Description |
|---|---|
| `src/types/test.ts` | `ScriptStepSchema`, `StepSchema` union, `TestFileSchema` with `steps` |
| `src/config/interpolate.ts` | `${VAR.NAME}` / `${ENV.NAME}` parsing |
| `src/runner/script.ts` | Shared script executor (parse stdout, build ANANKE, handle actions) |
| `src/runner/test.ts` | Step execution loop — script steps set vars, user/connect steps talk to agent |
| `src/assertions/engine.ts` | Script assertions via shared executor |

### Script path validation

Validate that script paths resolve to actual files at YAML parse time (test loading), not at script execution time. Fail fast on typos.

### Timeout behavior

When a script exceeds `timeout_ms`, the process is killed and the test fails with: `Script timed out after {timeout_ms}ms: {script_path}`. This applies uniformly to script steps and assertion scripts.

### Variable override warning

When a script sets a variable that already exists in the variable map, a debug-level log is emitted: `Variable "{key}" overridden by {script_location} (was: "{old}", now: "{new}")`. Last write wins.

### Variable accumulation flow

```
steps (sequential)
  step 0 (script): ANANKE={value:null, turns:[], variables:{}, turnIndex:null}
    → stdout: {variables: {A: "1"}}
    → vars = {A: "1"}
  step 1 (script): ANANKE={value:null, turns:[], variables:{A:"1"}, turnIndex:null}
    → stdout: {variables: {B: "2"}}
    → vars = {A: "1", B: "2"}

  step 2 (user): "msg with ${VAR.A}" → sends "msg with 1"
    → agent responds → turnData[0]  (turnIndex=0)
    assertion script (if any): ANANKE={value:..., turns:[turnData[0]], variables:{A:"1",B:"2"}, turnIndex:0}
      → stdout: {variables: {C: "3"}, reason: "checked"}
      → vars = {A: "1", B: "2", C: "3"}

  step 3 (script): ANANKE={value:null, turns:[turnData[0]], variables:{A:"1",B:"2",C:"3"}, turnIndex:null}
    → stdout: {variables: {D: "4"}}
    → vars = {A:"1", B:"2", C:"3", D:"4"}

  step 4 (user): "follow up about ${VAR.D}" → sends "follow up about 4"
    → agent responds → turnData[1]  (turnIndex=1)
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                    test.ts (runner)                  │
│  ┌────────────────────────────────────────────────┐  │
│  │                   steps[]                      │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │  │
│  │  │ Script   │ │ User     │ │ Connect      │   │  │
│  │  │ Step     │ │ Step     │ │ Step         │   │  │
│  │  │(set vars)│ │(send msg)│ │(observe)     │   │  │
│  │  └────┬─────┘ └────┬─────┘ └──────┬───────┘   │  │
│  └───────│─────────────│──────────────│───────────┘  │
│          │             │              │              │
│          ▼             ▼              ▼              │
│  ┌──────────────────────────────────────────────┐   │
│  │          script.ts (shared executor)          │   │
│  │  • Build ANANKE JSON (value, turns, vars)    │   │
│  │  • Set env: ANANKE + custom env              │   │
│  │  • Pass ANANKE to stdin                      │   │
│  │  • Parse stdout as JSON                      │   │
│  │  • Extract: variables, reason, action        │   │
│  │  • Validate action per location              │   │
│  │  • Handle exit 0 / non-zero                  │   │
│  └──────────────────────────────────────────────┘   │
│                        │                            │
│                        ▼                            │
│  ┌──────────────────────────────────────────────┐   │
│  │  interpolate.ts  (${VAR.X} / ${ENV.X})       │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘

Variable flow: script steps → user steps (interpolation) → assertion scripts
Each script merges output `variables` into shared map.
```
