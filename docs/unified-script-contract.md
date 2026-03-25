# Unified Script Contract

> **Status:** Draft

## Overview

Scripts appear in three places in ananke: **hooks** (preflight setup), **script turns** (dynamic message generation), and **script assertions** (custom evaluation). Today each has a different contract. This document defines a single, consistent contract for all scripts.

## Motivation

- Hooks output flat JSON with implicit variable semantics
- Assertion scripts use `ASSERT_VALUE` / `ASSERT_CONTEXT` env vars, ignore stdout
- No way to dynamically generate follow-up messages based on previous turns

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
| `turns` | `TurnData[]` | All completed turns so far |
| `variables` | `Record<string, string>` | Current variable map |
| `turnIndex` | `number \| null` | Current turn index, `null` for hooks and test-level assertions |

**stdin** receives the same JSON as `ANANKE`.

### What each script location sees

| Location | `value` | `turns` | `variables` | `turnIndex` |
|---|---|---|---|---|
| **Hook** | `null` | `[]` | accumulated from prior hooks | `null` |
| **Script turn** | `null` | completed turns | all hook vars + prior script outputs | current index |
| **Assertion (turn)** | the asserted value | completed turns | all vars | current index |
| **Assertion (test)** | the asserted value | all turns | all vars | `null` |

The `env` field in the long form adds extra env vars on top of `ANANKE`. These are for convenience — passing small values without parsing JSON.

---

## Output: stdout as JSON

Every script outputs a JSON object to stdout. All fields are optional:

```json
{
  "variables": { "TOKEN": "abc", "ORDER_ID": "ord_456" },
  "message": "Use shipping option: Express",
  "reason": "User record found in database"
}
```

| Field | Type | Used by | Description |
|---|---|---|---|
| `variables` | `Record<string, string>` | All | Merged into the variable map for subsequent interpolation |
| `message` | `string` | Script turn | The user message to send to the agent |
| `reason` | `string` | Assertion | Debug info captured in test output (for both pass and fail) |

### What each location uses

| Location | `variables` | `message` | `reason` |
|---|---|---|---|
| **Hook** | Merged into variable map | ignored | ignored |
| **Script turn** | Merged into variable map | **Required** — sent as user message | ignored |
| **Assertion** | Merged into variable map | ignored | Captured in assertion result for debugging |

Empty stdout or `{}` is valid — no variables set, no message, no reason.

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

The `action` field in stdout JSON controls execution flow. When absent, the default behavior applies (send message, set variables, etc.).

| Action | Description |
|---|---|
| `"skip_hook"` | Skip this hook. No variables set. Subsequent hooks and turns continue. |
| `"skip_turn"` | Skip this turn. No message sent, no assertions evaluated. Execution continues to next turn. |
| `"skip_test"` | Stop the entire test with a **SKIP** result (not PASS, not FAIL). No subsequent turns execute. |
| `"skip_assertion"` | Skip this assertion (vacuous pass). Other assertions and turns continue. |

### Which actions are valid where

| Location | Valid actions | Default (no action) |
|---|---|---|
| **Hook** | `skip_hook`, `skip_test` | Set variables |
| **Script turn** | `skip_turn`, `skip_test` | Send `message` to agent |
| **Assertion** | `skip_assertion`, `skip_test` | Pass/fail based on exit code |

Using an invalid action for the location (e.g., `skip_turn` in a hook) produces an error.

### Examples

```bash
# Skip this turn — continue to next
echo '{"action": "skip_turn"}'
exit 0

# Skip the entire test — preconditions not met
echo '{"action": "skip_test"}'
exit 0

# Normal execution — send a message
echo '{"message": "Use shipping option: Express"}'
exit 0

# Optional turn — skip if no coupon, continue either way
if [ -z "$COUPON" ]; then
  echo '{"action": "skip_turn"}'
else
  echo '{"message": "Apply coupon code '"$COUPON"'", "variables": {"HAS_COUPON": "true"}}'
fi
exit 0
```

---

## Variable Namespacing

Variables from scripts are referenced with the `VAR.` prefix:

```
${VAR.NAME}   ← script variables (from hooks, script turns, assertion scripts)
${ENV.NAME}   ← environment variables (process.env)
```

This replaces the current `${NAME}` syntax (which had no namespace prefix) with `${VAR.NAME}`.

### Variable accumulation

Variables accumulate throughout test execution. Each script's `variables` output is merged into the map, and subsequent scripts/turns can reference them:

```
hook 1 → {"variables": {"THREAD_ID": "th_123"}}
hook 2 → can use ${VAR.THREAD_ID}, outputs {"variables": {"TOKEN": "abc"}}
turn 1 → user: "Check ${VAR.THREAD_ID}" → sends "Check th_123"
turn 2 (script) → receives variables: {THREAD_ID: "th_123", TOKEN: "abc"}
                   outputs {"variables": {"ORDER_ID": "ord_1"}, "message": "Confirm order ord_1"}
turn 3 → user: "Status of ${VAR.ORDER_ID}" → sends "Status of ord_1"
```

Variables set by assertion scripts are also available to subsequent turns and assertions within the same test.

---

## Script Turn

A new turn type `type: script` that runs a script to generate the user message dynamically.

### YAML

```yaml
turns:
  - user: "Show me shipping options"
    assert:
      tool_names:
        some: { equals: "get_shipping_options" }

  - type: script
    script: "scripts/pick-cheapest-option.sh"
    assert:
      tool_names:
        some: { equals: "calculate_total" }

  - type: script
    script:
      run: "scripts/maybe-apply-coupon.sh"
      timeout_ms: 5000
      env:
        COUPON_CODE: "${VAR.COUPON}"
    assert:
      tool_names:
        some: { equals: "apply_coupon" }
```

### Behavior

1. Script receives `ANANKE` with all completed turns and current variables
2. Script outputs JSON with `message` (required) and optionally `variables`
3. The `message` is sent to the agent as the user message for this turn
4. Any `variables` are merged into the map before assertion evaluation
5. Turn assertions are evaluated on the agent's response

### Skip

Scripts control skipping via the `action` field in stdout:

- `{"action": "skip_turn"}` — skip this turn, continue to next turn. No message sent, no assertions evaluated.
- `{"action": "skip_test"}` — stop the entire test with a SKIP result. Use when preconditions aren't met.

### Error

If `message` is missing from stdout when exit code is 0, the script turn fails with: `Script turn did not produce a "message" field`.

### Message interpolation

The `message` field from script stdout is sent as-is to the agent. It is **not** interpolated against the variable map. The script already has full access to all variables via `ANANKE` — if it needs a variable value in the message, it should include it directly in its stdout. This avoids double-interpolation and unexpected `${}` expansion.

### Recording and replay

During **recording**, script turns execute normally — the script generates the message, the message is sent, and the agent's response events are recorded.

During **replay**, script turns still execute the script (to generate the message), but the agent's response comes from the recorded events. The script receives the same `ANANKE` input it would during normal execution (completed turns from replay, current variables). This means script turn behavior may differ between record and replay if the turn data changes — but this is consistent with how the tool works (replay replays events, not script logic).

---

## Script Assertion (Updated)

The existing `script` assertion is updated to use the unified contract.

### Changes from current behavior

| Aspect | Before | After |
|---|---|---|
| Input env var | `ASSERT_VALUE`, `ASSERT_CONTEXT` | `ANANKE` (single JSON with `value`, `turns`, `variables`, `turnIndex`) |
| stdin | JSON of asserted value | JSON of full `ANANKE` object |
| stdout | ignored | parsed as JSON — `reason` captured, `variables` merged |
| Skip | not supported | `{"action": "skip_assertion"}` or `{"action": "skip_test"}` |

### Examples

```yaml
# Assertion with debug reason
turns:
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
turns:
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

## Hook (Updated)

Hooks are updated to use the same stdout contract.

### Changes from current behavior

| Aspect | Before | After |
|---|---|---|
| stdout format | flat JSON `{"KEY": "val"}` | `{"variables": {"KEY": "val"}}` |
| Input | none | `ANANKE` env var (value=null, turns=[], variables from prior hooks) |
| Skip | not supported | `{"action": "skip_hook"}` or `{"action": "skip_test"}` |

### Migration

Before:
```bash
echo '{"THREAD_ID": "th_123", "TOKEN": "abc"}'
```

After:
```bash
echo '{"variables": {"THREAD_ID": "th_123", "TOKEN": "abc"}}'
```

### Variable references

Before:
```yaml
turns:
  - user: "Check thread ${THREAD_ID}"
```

After:
```yaml
turns:
  - user: "Check thread ${VAR.THREAD_ID}"
```

---

## TurnData Shape (for reference)

The `turns` array in the `ANANKE` input contains these objects:

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

hooks:
  - cmd: ["bash", "scripts/seed-cart.sh"]
    # stdout: {"variables": {"CART_ID": "cart_789"}}

turns:
  # Turn 1: static message
  - user: "Show shipping options for cart ${VAR.CART_ID}"
    assert:
      tool_names:
        some: { equals: "get_shipping_options" }

  # Turn 2: script generates message from turn 1's response
  - type: script
    script: "scripts/pick-cheapest-option.sh"
    assert:
      tool_names:
        some: { equals: "calculate_total" }

  # Turn 3: script may skip if no coupon
  - type: script
    script:
      run: "scripts/maybe-apply-coupon.sh"
      env:
        COUPON: "${VAR.COUPON_CODE}"
    assert:
      tool_names:
        some: { equals: "apply_coupon" }

  # Turn 4: static message using variables set by earlier scripts
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
echo "{\"message\": \"Use shipping option: $CHEAPEST\"}"
```

```bash
#!/bin/bash
# scripts/maybe-apply-coupon.sh
COUPON="$COUPON"  # from env field
if [ -z "$COUPON" ]; then
  echo '{"action": "skip_turn"}'
  exit 0
fi
echo "{\"message\": \"Apply coupon code $COUPON\", \"variables\": {\"HAS_COUPON\": \"true\"}}"
```

---

## Implementation Changes

| File | Change | Description |
|---|---|---|
| `src/types/test.ts` | Modify | Add `ScriptTurnSchema`, update `TurnSchema` union |
| `src/config/interpolate.ts` | Modify | Change `${NAME}` → `${VAR.NAME}` parsing |
| `src/hooks/executor.ts` | Modify | Parse new stdout format, pass `ANANKE` input, support `action` field |
| `src/runner/test.ts` | Modify | Handle script turns, pass variables through, accumulate from all scripts |
| `src/runner/script.ts` | New | Shared script executor (parse stdout JSON, build ANANKE, handle actions) |
| `src/assertions/evaluator.ts` | Modify | Use `ANANKE` env var, parse stdout for `reason`/`variables`/`action` |
| `examples/*.test.yaml` | Modify | Update `${VAR}` → `${VAR.NAME}` references |
| `docs/mvp.md` | Modify | Update hook and variable documentation |
| `docs/assertions-v2.md` | Modify | Update script assertion section |

### Breaking Changes

1. **Hook stdout format**: `{"KEY": "val"}` → `{"variables": {"KEY": "val"}}`
2. **Variable references**: `${NAME}` → `${VAR.NAME}`
3. **Assertion script env vars**: `ASSERT_VALUE`/`ASSERT_CONTEXT` → `ANANKE`
4. **Assertion script stdin**: value only → full ANANKE object

---

## NOT in scope

- **Hook YAML shape migration** (`cmd: [...]` → `script: "..."`) — hooks keep their current YAML shape. Unifying hook YAML with the script shape is a separate concern.
- **SDK/helper libraries** — Language-specific helpers (e.g., `ananke-sdk` for Node.js) for script authors. Future work.
- **Script debugging CLI** — `ananke script-debug` command for testing scripts in isolation. Deferred to TODOS.md.
- **Backward compatibility shim** — No dual-format support for hooks. Clean break.

---

## Additional Implementation Guidance

### Script path validation

Validate that script paths resolve to actual files at YAML parse time (test loading), not at script execution time. Fail fast on typos.

### Timeout behavior

When a script exceeds `timeout_ms`, the process is killed and the test fails with: `Script timed out after {timeout_ms}ms: {script_path}`. This applies uniformly to hooks, script turns, and assertion scripts.

### Variable override warning

When a script sets a variable that already exists in the variable map, emit a debug-level log: `Variable "{key}" overridden by {script_location} (was: "{old}", now: "{new}")`. Do not fail — last write wins.

### Logging

The shared script executor should log at debug level:
- Script path and timeout
- Exit code
- Parsed output shape (which fields present)
- Elapsed time

### Variable accumulation flow

```
hooks (sequential)
  hook 1: ANANKE={value:null, turns:[], variables:{}, turnIndex:null}
    → stdout: {variables: {A: "1"}}
    → vars = {A: "1"}
  hook 2: ANANKE={value:null, turns:[], variables:{A:"1"}, turnIndex:null}
    → stdout: {variables: {B: "2"}}
    → vars = {A: "1", B: "2"}

turns (sequential)
  turn 0 (user): "msg with ${VAR.A}" → sends "msg with 1"
    → agent responds → turnData[0]
    assertion script (if any): ANANKE={value:..., turns:[turnData[0]], variables:{A:"1",B:"2"}, turnIndex:0}
      → stdout: {variables: {C: "3"}, reason: "checked"}
      → vars = {A: "1", B: "2", C: "3"}

  turn 1 (script): ANANKE={value:null, turns:[turnData[0]], variables:{A:"1",B:"2",C:"3"}, turnIndex:1}
    → stdout: {message: "follow up about 3", variables: {D: "4"}}
    → sends "follow up about 3" (message sent as-is, NOT interpolated)
    → vars = {A:"1", B:"2", C:"3", D:"4"}
```

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|
| 1 | CEO | Mode: SELECTIVE EXPANSION | P1+P6 | Plan is well-scoped; surface expansions individually | EXPANSION (too aggressive), HOLD (misses opportunities) |
| 2 | CEO | Approach A (unified contract) | P1+P5 | Complete solution, explicit contract. B creates tech debt, C is an ocean | Approach B (additive only), Approach C (SDK-first) |
| 3 | CEO | Skip backward compat shim | P5 | Small user base, shim adds permanent code. Clean break is explicit | Adding shim |
| 4 | CEO | Defer script debugging CLI | P3 | Nice but not blocking. Add to TODOS.md | Include now |
| 5 | CEO | Include script path validation at parse time | P1 | Fail fast on typos. Boil this lake | Defer |
| 6 | CEO | Include variable override warning | P5 | Silent overwrites mask bugs. Debug log is explicit | Ignore / fail on conflict |
| 7 | CEO | Document timeout behavior | P5 | Explicit > implicit. Users need to know what happens | Leave undocumented |
| 8 | Eng | Variable propagation via mutable EvalContext | P5 | Simpler than changing return types. Matches existing logger pattern | New return type |
| 9 | Eng | Do NOT interpolate script turn `message` field | P5 | Script has full access to vars via ANANKE. Double-interpolation is confusing | Interpolate message |
| 10 | Eng | Use async execa in shared executor | P3 | Hook executor is already async. Consistency + don't block event loop | Keep sync |
| 11 | Eng | Add recording/replay guidance for script turns | P1 | Script must still execute during replay to generate message | Omit |
| 12 | Eng | Test env var size limit with large payloads | P1 | ANANKE could exceed 128KB with many turns. stdin is the fallback | Ignore |
| 13 | Eng | Do not interpolate message field from script stdout | P5 | Avoids double-interpolation. Script has ANANKE access | Interpolate |
| 14 | Eng | Script turns still execute during replay | P1 | Script generates message; only agent response comes from recording | Skip script in replay |
| 15 | CEO-voice | Skip namespace future-proofing | User | User chose to ship with VAR/ENV only. Namespace design deferred | Design full namespace system now |
| 16 | CEO-voice | Ship everything together (not decoupled) | User | Small user base, clean break is cheaper now | Ship script turns first, defer breaking changes |
| 17 | Eng-voice | Replace exit 77 with `action` field in stdout | User | Enables skip_turn (continue) vs skip_test (stop). More expressive | Exit codes for skip |
| 18 | Eng-voice | Fix SQL injection in example scripts | P1 | Use parameterized queries to prevent copy-paste security bugs | Leave as-is |
| 19 | Eng-voice | Location-specific action validation | P5 | `skip_turn` in a hook is an error. Explicit > silent ignore | Accept any action anywhere |

---

## CEO Dual Voices

### CLAUDE SUBAGENT (CEO — strategic independence)

5 findings. Key concerns:
1. **Framing buries the feature** (High) — dynamic script turns are the real capability; the doc leads with plumbing cleanup. *Auto-decided: keep current framing. P3 — doc is implementation spec, not marketing.*
2. **"One shape" premise overstated** (Medium) — hook format change adds friction for simple cases. *Auto-decided: accept. P5 — explicit consistency > per-location special cases.*
3. **Single ANANKE blob is worse for 80% case** (Medium) — assertion scripts now need jq instead of `$ASSERT_VALUE`. *Auto-decided: accept trade-off. P1 — one contract everywhere is worth the jq cost.*
4. **Four breaking changes without version gating** (Critical per subagent) — *Auto-decided: skip version gating. User explicitly chose clean break (Decision #16).*
5. **Variable namespace not future-proofed** (High) — `VAR.`/`ENV.` designed ad hoc. *Auto-decided: defer. User explicitly chose this (Decision #15).*

### CODEX SAYS (CEO — strategy challenge)

Codex unavailable — proceeding with subagent only. Tagged `[subagent-only]`.

### CEO CONSENSUS TABLE

```
CEO DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   PARTIAL N/A    PARTIAL [subagent-only]
  2. Right problem to solve?           YES     N/A    YES [subagent-only]
  3. Scope calibration correct?        YES     N/A    YES [subagent-only]
  4. Alternatives sufficiently explored?PARTIAL N/A   PARTIAL [subagent-only]
  5. Competitive/market risks covered? FLAGGED N/A    FLAGGED [subagent-only]
  6. 6-month trajectory sound?         YES     N/A    YES [subagent-only]
═══════════════════════════════════════════════════════════════
Missing voice = N/A (not CONFIRMED). Single critical finding from one voice = flagged regardless.
```

Notes:
- Premises PARTIAL: subagent challenged "one shape" premise but we accepted the trade-off per P1.
- Alternatives PARTIAL: subagent suggested TS plugin API — valid future direction, added to NOT in scope.
- Competitive FLAGGED: subagent noted agent frameworks bundling testing. Acknowledged but not actionable for this doc.

---

## ENG Dual Voices

### CLAUDE SUBAGENT (Eng — independent review)

12 findings. Key resolutions:
1. **SQL injection in examples** (Critical) — Fixed. Parameterized queries in all examples. (Decision #18)
2. **Sync script execution blocks event loop** (High) — Addressed. Plan specifies async execa. (Decision #10)
3. **ANANKE env var size limits** (High) — Addressed. stdin is documented as primary channel. (Decision #12)
4. **Breaking changes without migration** (High) — User chose clean break. (Decision #16)
5. **Exit 77 skip semantics too coarse** (High) — Fixed. Replaced with `action` field: `skip_turn` vs `skip_test`. (Decision #17)
6. **Assertion variable mutation ordering** (Medium) — Addressed. Doc specifies last-write-wins + debug warning. (Decision #6)
7. **No stderr capture on success** (Medium) — Noted, low priority. Stderr on exit 0 is debug info at trace level (existing behavior in hooks).
8. **stdout JSON parsing fragility** (Medium) — Doc specifies "entire stdout must be valid JSON." Clear error message specified.
9. **`message` field validation** (Medium) — Trivial to add: non-empty trimmed string.
10. **No test/run ID for concurrency** (Medium) — Valid. Deferred to NOT in scope (test parallelism is future work).
11. **Missing test plan items** (Medium) — Schema validation, timeout kill signal, binary stdout. Good test cases.
12. **Interpolation regex** (Low) — Implementation detail, straightforward.

### CODEX SAYS (Eng — architecture challenge)

Codex unavailable — proceeding with subagent only. Tagged `[subagent-only]`.

### ENG CONSENSUS TABLE

```
ENG DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               YES     N/A    YES [subagent-only]
  2. Test coverage sufficient?         PARTIAL N/A    PARTIAL [subagent-only]
  3. Performance risks addressed?      YES     N/A    YES [subagent-only]
  4. Security threats covered?         FIXED   N/A    FIXED [subagent-only]
  5. Error paths handled?              YES     N/A    YES [subagent-only]
  6. Deployment risk manageable?       YES     N/A    YES [subagent-only]
═══════════════════════════════════════════════════════════════
Missing voice = N/A (not CONFIRMED). Single critical finding from one voice = flagged regardless.
```

Notes:
- Test coverage PARTIAL: subagent identified 8 edge cases for the test plan (schema validation, timeout kill signal, binary stdout, etc.)
- Security FIXED: SQL injection in examples fixed (Decision #18).

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                    test.ts (runner)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ hooks[]  │→ │ turns[]  │→ │ test assertions  │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │              │                 │             │
│       ▼              ▼                 ▼             │
│  ┌─────────┐   ┌──────────┐   ┌──────────────┐     │
│  │executor │   │ UserTurn │   │  evaluator   │     │
│  │  .ts    │   │ Script   │   │    .ts       │     │
│  │(hooks)  │   │  Turn    │   │(assertions)  │     │
│  └────┬────┘   │ Connect  │   └──────┬───────┘     │
│       │        └────┬─────┘          │              │
│       │             │                │              │
│       ▼             ▼                ▼              │
│  ┌──────────────────────────────────────────────┐   │
│  │          script.ts (NEW — shared executor)   │   │
│  │  • Build ANANKE JSON (value, turns, vars)    │   │
│  │  • Set env: ANANKE + custom env              │   │
│  │  • Pass ANANKE to stdin                      │   │
│  │  • Parse stdout as JSON                      │   │
│  │  • Extract: variables, message, reason,      │   │
│  │             action                           │   │
│  │  • Validate action per location              │   │
│  │  • Handle exit 0 / non-zero                  │   │
│  └──────────────────────────────────────────────┘   │
│                        │                            │
│                        ▼                            │
│  ┌──────────────────────────────────────────────┐   │
│  │  interpolate.ts  (${VAR.X} / ${ENV.X})       │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘

Variable flow: hooks → script turns → assertion scripts
Each step merges output `variables` into shared map.
```

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | clean | 7 auto-decisions, 0 taste decisions |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | clean | 7 auto-decisions, all resolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | skipped | No UI scope |
| CEO Voices | autoplan subagent | Independent 2nd opinion | 1 | complete | 5 findings, 3 resolved, 2 deferred per user |
| Eng Voices | autoplan subagent | Independent 2nd opinion | 1 | complete | 12 findings, 5 fixed, 5 already addressed, 2 deferred |

**VERDICT:** APPROVED — plan passed CEO and Eng review with dual voices. 19 auto-decisions logged. 2 user decisions (exit 77 → action field, ship together). SQL injection fixed. Architecture diagram produced. No taste decisions remain.
