# Script Contract

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
  "steps": [],
  "variables": {},
  "stepIndex": null
}
```

| Field | Type | Description |
|---|---|---|
| `value` | `any \| null` | Primary input value — the asserted value for assertions, `null` otherwise |
| `steps` | `StepData[]` | All completed steps so far (only agent-facing steps produce step data) |
| `variables` | `Record<string, string>` | Current variable map |
| `stepIndex` | `number \| null` | Current step index, `null` for script steps |

**stdin** receives the same JSON as `ANANKE`.

### What each script location sees

| Location | `value` | `steps` | `variables` | `stepIndex` |
|---|---|---|---|---|
| **Script step** | `null` | completed steps | accumulated from prior steps | `null` |
| **Assertion (step)** | the asserted value | completed steps | all vars | current index |

The `env` field in the long form adds extra env vars on top of `ANANKE`. These are for convenience — passing small values without parsing JSON.

---

## Output: stdout as JSON

Every script outputs a JSON object to stdout. The only recognized field is `variables`:

```json
{
  "variables": { "TOKEN": "abc", "ORDER_ID": "ord_456" }
}
```

| Field | Type | Description |
|---|---|---|
| `variables` | `Record<string, string>` | Merged into the variable map for subsequent interpolation |

Empty stdout or `{}` is valid — no variables set.

### Error: non-JSON stdout

If stdout is not valid JSON and exit code is 0, the script fails with a parse error. This is consistent — all scripts speak JSON.

---

## Exit Codes

Exit codes are the sole control mechanism. No action fields, no special JSON keys.

### Script steps

| Code | Meaning |
|---|---|
| **0** | Success — parse stdout JSON, merge variables |
| **non-zero** | Skip test — preconditions not met (test result: SKIP, not FAIL) |

### Assertion scripts

| Code | Meaning |
|---|---|
| **0** | Pass — assertion succeeded |
| **non-zero** | Fail — assertion failed, stderr captured as reason |

### Examples

```bash
# Normal execution — set variables
echo '{"variables": {"THREAD_ID": "th_123", "TOKEN": "abc"}}'
exit 0

# Skip the entire test — preconditions not met
echo '{}' >&2
exit 1

# Conditional setup — skip test if env not available
if [ -z "$REQUIRED_TOKEN" ]; then
  echo "Missing REQUIRED_TOKEN" >&2
  exit 1
fi
echo '{"variables": {"TOKEN": "'"$REQUIRED_TOKEN"'"}}'
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
step 3 (message)   → message: "Check ${VAR.THREAD_ID}" → sends "Check th_123"
step 4 (script) → receives variables: {THREAD_ID: "th_123", TOKEN: "abc"}
                   outputs {"variables": {"ORDER_ID": "ord_1"}}
step 5 (message)   → message: "Status of ${VAR.ORDER_ID}" → sends "Status of ord_1"
```

Variables set by assertion scripts are also available to subsequent steps and assertions within the same test.

---

## Steps

A test file contains an ordered list of **steps**. Each step is one of three types:

### Message step — sends a message to the agent

```yaml
steps:
  - message: "Show me shipping options for cart ${VAR.CART_ID}"
    expect:
      tool_names:
        some: { equals: "get_shipping_options" }
```

The `message` field is interpolated with `${VAR.X}` and `${ENV.X}` before sending. Assertions evaluate on the agent's response.

### Script step — runs a script, sets variables

```yaml
steps:
  - script: "scripts/seed-cart.sh"
    # stdout: {"variables": {"CART_ID": "cart_789"}}

  - script:
      run: "scripts/pick-cheapest-option.sh"
      timeout_ms: 5000
      env:
        PREV_RESPONSE: "${VAR.LAST_TEXT}"
```

Script steps:
1. Run the script with `ANANKE` containing all completed steps and current variables
2. On exit 0: parse stdout JSON and merge `variables` into the map
3. On non-zero exit: skip the test (preconditions not met)
4. **Do not send any message to the agent**
5. **Do not take assertions** (no agent response to assert on)

Script steps always execute, even during replay mode. Only agent steps are replayed from recordings.

### Resume step — observe an existing thread

```yaml
steps:
  - type: resume
    resume: "threadId"
    expect:
      text:
        contains: "status"
```

Connects to an existing AG-UI thread without sending a message. Assertions evaluate on the observed response.

---

## Script Assertion

Script assertions use the unified contract to perform custom evaluation. Exit 0 = pass, non-zero = fail.

### Examples

```yaml
# Assertion script
steps:
  - message: "Create user John"
    expect:
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
  echo '{}'
  exit 0
else
  echo "User not found in users table" >&2
  exit 1
fi
```

### Assertion with variable output

An assertion script can set variables for downstream use:

```yaml
steps:
  - message: "Create project Alpha"
    expect:
      tools:
        some:
          having:
            name: { equals: "create_project" }
            result.json.project_id:
              script: "scripts/verify_and_capture.sh"

  - message: "Add a task to project ${VAR.CREATED_PROJECT_ID}"
```

```bash
#!/bin/bash
# scripts/verify_and_capture.sh
PROJECT_ID=$(echo "$ANANKE" | jq -r '.value')

if psql -v id="$PROJECT_ID" -t -c "SELECT 1 FROM projects WHERE id = :'id'" | grep -q 1; then
  echo "{\"variables\": {\"CREATED_PROJECT_ID\": \"$PROJECT_ID\"}}"
  exit 0
else
  echo "Project not found" >&2
  exit 1
fi
```

---

## StepData Shape (for reference)

The `steps` array in the `ANANKE` input contains these objects (all step types produce step data):

```typescript
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
  - script: "scripts/seed-cart.sh"
    # stdout: {"variables": {"CART_ID": "cart_789"}}

  # Step 2: user message using variable from setup
  - message: "Show shipping options for cart ${VAR.CART_ID}"
    expect:
      tool_names:
        some: { equals: "get_shipping_options" }

  # Step 3: script picks cheapest option from step 2's response
  - script: "scripts/pick-cheapest-option.sh"
    # stdout: {"variables": {"SHIPPING_OPTION": "Express"}}

  # Step 4: send the picked option
  - message: "Use shipping option: ${VAR.SHIPPING_OPTION}"
    expect:
      tool_names:
        some: { equals: "calculate_total" }

  # Step 5: script checks coupon — exit 1 skips test if not available
  - script:
      run: "scripts/require-coupon.sh"
      env:
        COUPON: "${ENV.COUPON_CODE}"
    # stdout: {"variables": {"COUPON_MSG": "Apply coupon code ABC123"}}
    # or: exit 1 (skip test)

  # Step 6: apply coupon (message comes from script variable)
  - message: "${VAR.COUPON_MSG}"
    expect:
      tool_names:
        some: { equals: "apply_coupon" }

  # Step 7: confirm and pay
  - message: "Confirm and pay for order ${VAR.ORDER_ID}"
    expect:
      tools:
        filter:
          having:
            name: { equals: "charge_card" }
        count: { equals: 1 }
```

```bash
#!/bin/bash
# scripts/pick-cheapest-option.sh
CHEAPEST=$(echo "$ANANKE" | jq -r '
  .steps[-1].toolCalls[]
  | select(.name == "get_shipping_options")
  | .result | fromjson
  | .options | sort_by(.price)[0].name
')
echo "{\"variables\": {\"SHIPPING_OPTION\": \"$CHEAPEST\"}}"
```

```bash
#!/bin/bash
# scripts/require-coupon.sh
COUPON="$COUPON"  # from env field
if [ -z "$COUPON" ]; then
  echo "No coupon code available" >&2
  exit 1
fi
echo "{\"variables\": {\"COUPON_MSG\": \"Apply coupon code $COUPON\", \"HAS_COUPON\": \"true\"}}"
```

---

## Implementation

| File | Description |
|---|---|
| `src/types/test.ts` | `ScriptStepSchema`, `StepSchema` union, `TestFileSchema` with `steps` |
| `src/config/interpolate.ts` | `${VAR.NAME}` / `${ENV.NAME}` parsing |
| `src/runner/script.ts` | Shared script executor (parse stdout, build ANANKE) |
| `src/runner/executor.ts` | Step execution loop — script steps set vars, user/resume steps talk to agent |
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
  step 0 (script): ANANKE={value:null, steps:[], variables:{}, stepIndex:null}
    → stdout: {variables: {A: "1"}}
    → vars = {A: "1"}
  step 1 (script): ANANKE={value:null, steps:[], variables:{A:"1"}, stepIndex:null}
    → stdout: {variables: {B: "2"}}
    → vars = {A: "1", B: "2"}

  step 2 (message): "msg with ${VAR.A}" → sends "msg with 1"
    → agent responds → stepData[0]  (stepIndex=0)
    assertion script (if any): ANANKE={value:..., steps:[stepData[0]], variables:{A:"1",B:"2"}, stepIndex:0}
      → stdout: {variables: {C: "3"}}
      → vars = {A: "1", B: "2", C: "3"}

  step 3 (script): ANANKE={value:null, steps:[stepData[0]], variables:{A:"1",B:"2",C:"3"}, stepIndex:null}
    → stdout: {variables: {D: "4"}}
    → vars = {A:"1", B:"2", C:"3", D:"4"}

  step 4 (message): "follow up about ${VAR.D}" → sends "follow up about 4"
    → agent responds → stepData[1]  (stepIndex=1)
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                  executor.ts (runner)                │
│  ┌────────────────────────────────────────────────┐  │
│  │                   steps[]                      │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │  │
│  │  │ Script   │ │ User     │ │ Resume       │   │  │
│  │  │ Step     │ │ Step     │ │ Step         │   │  │
│  │  │(set vars)│ │(send msg)│ │(observe)     │   │  │
│  │  └────┬─────┘ └────┬─────┘ └──────┬───────┘   │  │
│  └───────│─────────────│──────────────│───────────┘  │
│          │             │              │              │
│          ▼             ▼              ▼              │
│  ┌──────────────────────────────────────────────┐   │
│  │          script.ts (shared executor)          │   │
│  │  • Build ANANKE JSON (value, steps, vars)    │   │
│  │  • Set env: ANANKE + custom env              │   │
│  │  • Pass ANANKE to stdin                      │   │
│  │  • Parse stdout as JSON                      │   │
│  │  • Extract: variables                        │   │
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
