# Assertions v2 Proposal

## Design Principles

1. **Primitive-based**: assertions are defined for primitive types (string, number, array, object)
2. **Selectors**: built-in selectors extract common data from the response, feeding it into primitive assertions
3. **Composable**: `and`, `or`, `not` combinators allow arbitrary business logic
4. **Uniform**: the same assertion vocabulary works regardless of what produced the value

## Response Object

During assertion evaluation, the system has access to this data:

### Turn-level

```typescript
interface TurnData {
  turnIndex: number;
  toolCalls: ToolCall[];   // array of objects
  assistantText: string;   // full response text
  startTs: number;         // first event timestamp (ms)
  endTs: number;           // last event timestamp (ms)
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: number;       // event arrival time (ms)
}
```

### Test-level (aggregated across all turns)

```typescript
interface TestData {
  turns: TurnData[];
  allToolCalls: ToolCall[];
  allAssistantTexts: string[];
  startTs: number;
  endTs: number;
}
```

## Operator Categories

Every node in an assertion tree is one of three things:

1. **Selector** — extracts a value from the response (top-level only)
2. **Transform** — reshapes data, then contains assertions on the result
3. **Assertion** — evaluates a value, produces pass/fail

Data flows: **selector → transform\* → assertion**

### Selectors

Selectors are the top-level keys in an assert block. Each extracts a typed value from the response.

| Selector | Type | Extracts |
|---|---|---|
| `text` | string | `assistantText` (turn) or `allAssistantTexts.join("\n")` (test) |
| `tool_names` | array\<string\> | `toolCalls.map(c => c.name)` |
| `tools` | array\<object\> | `toolCalls` (full ToolCall objects) |
| `duration_ms` | number | `endTs - startTs` |
| `idle_ms` | number | max gap among: start-to-first-tool, between consecutive tools, last-tool-to-end. If zero tool calls, `idle_ms` = `endTs - startTs`. |

### Transforms

Transforms reshape data before assertions are applied. They do not produce pass/fail themselves.

| Transform | Input → Output | Description |
|---|---|---|
| `at` | object → any | Extract value at a dot-notation path |
| `json` | string → any | Parse JSON string into structured data |
| `filter` | array → array | Keep elements matching a predicate, assert on sub-array |
| `match` | object → (shorthand) | Dot-path keys for multiple field assertions on an object |

### Assertions

Assertions evaluate a value and produce pass/fail.

**String** — applies when value is a string:

| Operator | Description |
|---|---|
| `equals` | Exact string match |
| `contains` | Substring match |
| `starts_with` | String prefix match |
| `ends_with` | String suffix match |
| `must_match` | Regex pattern(s) that must all match |
| `must_not_match` | Regex pattern(s) that must all NOT match |

All regex operators accept a single string or array of strings. Patterns use `/pattern/flags` syntax for regex flags (e.g. `/hello/i`).

**Number** — applies when value is a number:

| Operator | Description |
|---|---|
| `exact` | Equals this value |
| `min` | Greater than or equal to |
| `max` | Less than or equal to |

**Array** — applies when value is an array:

| Operator | Description |
|---|---|
| `count` | Number assertion on array length |
| `every` | All elements must satisfy the assertion |
| `some` | At least one element must satisfy the assertion |
| `none` | No element may satisfy the assertion |
| `ordered` | Elements matching each assertion appear in order (not necessarily adjacent) |
| `filter` | Transform: keep matching elements, then apply assertions on the sub-array |

**Object** — applies when value is an object:

| Operator | Description |
|---|---|
| `has_key` | Key exists on the object |
| `not_has_key` | Key does not exist |
| `at` | Transform: extract value at path, then apply assertions |
| `match` | Transform: dot-path shorthand for multiple `at` assertions (implicit AND) |

**Meta** — applies to any type:

| Operator | Description |
|---|---|
| `and` | All assertions must pass |
| `or` | At least one assertion must pass |
| `not` | Invert the result |

Multiple keys at the same level are implicitly ANDed.

## Type Checking

Operators are type-specific. If an operator receives a value of the wrong type, the assertion **fails** with a clear error message describing the mismatch.

For selectors, the type is always known:
- `text` always produces a string
- `tools` always produces an array
- `duration_ms` always produces a number

For transforms, the output type depends on the data at runtime:
- `json` parses a string into any type (object, array, number, string, boolean)
- `at` extracts a value of any type from an object

When a type mismatch occurs, the assertion result includes:
- The operator that failed
- The expected type(s)
- The actual type and value received
- The path through selectors/transforms that produced the value

```yaml
# Example error output:
# FAIL: "min" expects number but got string
#   at: tools → filter → match → result → json → status
#   value: "ok"
#   hint: use "equals", "contains", or "must_match" for string values
```

This is a runtime check, not a schema validation. The assertion fails like any other failed assertion — it appears in the test results with a clear reason.

## Transforms in Detail

### `at` — extract value at path

Extract a nested value from an object using dot-notation. Supports array indexing with `[]`.

```yaml
# Full form
tools:
  some:
    at:
      path: "args.user.name"
      assert: { equals: "John" }

# Array indexing
tools:
  some:
    at:
      path: "args.items[0]"
      assert: { equals: "first" }
```

If the path does not exist, the assertion fails with "path not found".

### `json` — parse JSON string

Parse a string value as JSON, then apply assertions on the parsed result. The parsed value can be any JSON type (object, array, number, string, boolean, null).

```yaml
# Parse tool result as JSON object, assert on fields
tools:
  some:
    match:
      name: { equals: "search" }
      result:
        json:
          match:
            status: { equals: "ok" }
            items: { count: { min: 1 } }

# Parse as JSON array
tools:
  some:
    match:
      name: { equals: "list_items" }
      result:
        json:
          count: { min: 3 }
          every: { must_match: "http.*" }

# Parse as JSON number
tools:
  some:
    match:
      name: { equals: "get_score" }
      result:
        json:
          min: 80
          max: 100
```

If the value is not a valid JSON string, the assertion fails with "invalid JSON".

### `filter` — keep matching elements

Filter an array to elements matching a predicate, then apply assertions on the resulting sub-array. The predicate uses the same assertion syntax.

```yaml
# Count tools matching a name
tools:
  filter:
    match:
      name: { equals: "search" }
  count: { exact: 2 }

# Filter by multiple conditions, then assert on results
tools:
  filter:
    match:
      name: { equals: "search" }
      args.query: { must_match: "weather" }
  count: { exact: 2 }
  every:
    match:
      result:
        json:
          match:
            status: { equals: "ok" }
```

### `match` — dot-path shorthand

Apply assertions to multiple fields of an object using dot-notation keys. Multiple keys are implicitly ANDed. This avoids verbose nested `at` blocks.

```yaml
# These are equivalent:
tools:
  some:
    match:
      name: { equals: "search" }
      args.query: { must_match: "weather" }

tools:
  some:
    and:
      - at: { path: "name", assert: { equals: "search" } }
      - at: { path: "args.query", assert: { must_match: "weather" } }
```

Inside `match`, every key is interpreted as a dot-path into the object. This avoids ambiguity with assertion operator names — `match` keys are always paths, never operators.

## Backwards Compatibility

The v2 assertion system replaces v1. The mapping from v1 to v2:

| v1 | v2 |
|---|---|
| `text.must_match` | `text.must_match` (unchanged) |
| `text.must_not_match` | `text.must_not_match` (unchanged) |
| `timing.max_duration_ms: 5000` | `duration_ms: { max: 5000 }` |
| `timing.max_idle_ms: 1000` | `idle_ms: { max: 1000 }` |
| `timing.max_duration_ms: false` | omit `duration_ms` |
| `tools.forbid: [X]` | `tool_names: { none: { equals: "X" } }` |
| `tools.require: [{name: X}]` | `tool_names: { some: { equals: "X" } }` |
| `tools.require: [{name: X, count: {exact: 2}}]` | `tools: { filter: { match: { name: { equals: "X" } } }, count: { exact: 2 } }` |
| `tools.require: [{name: X, after: Y}]` | `tool_names: { ordered: [{ equals: "Y" }, { equals: "X" }] }` |
| `tools.require: [{name: X, args_match: {k: v}}]` | `tools: { some: { match: { name: { equals: "X" }, args.k: { must_match: "v" } } } }` |
| `tools.forbid_calls: [{name: X, args_match: {k: v}}]` | `tools: { none: { match: { name: { equals: "X" }, args.k: { must_match: "v" } } } }` |

## Examples

### S1: Pure conversation, no tools

```yaml
assert:
  text:
    must_match:
      - "Kai"
      - "TestOps|TrueTest"
  tools:
    count: { exact: 0 }
```

### S2: Single tool use

```yaml
turns:
  - user: "What's the status of project P1?"
    assert:
      tool_names:
        some: { equals: "get_project_status" }
      text:
        must_match: "status"
      duration_ms:
        max: 15000
```

### S3: Multi-tool with ordering

```yaml
turns:
  - user: "Find iterations for project P1 and show details"
    assert:
      tool_names:
        ordered:
          - equals: "intent_agent"
          - equals: "find_iterations"
        count: { min: 2 }
      idle_ms:
        max: 10000
```

### S4: Multiple insight tools

```yaml
turns:
  - user: "Give me a comprehensive quality report for project P1"
    assert:
      tool_names:
        some: { must_match: "get_.*_insights" }
        none: { must_match: "stability_.*" }
        count: { min: 3 }
      text:
        must_match: "report|analysis|insight"
      duration_ms:
        max: 60000
```

### S5: URL generation

```yaml
turns:
  - user: "Set up the project"
    assert:
      tool_names:
        some: { equals: "intent_agent" }
  - user: "Generate test URLs for the latest iteration"
    assert:
      tool_names:
        ordered:
          - equals: "intent_agent"
          - equals: "find_iterations"
          - equals: "generate_urls"
      text:
        must_match: "http"
```

### S8: Branching response (clarification vs draft)

```yaml
turns:
  - user: "Generate report"
    assert:
      or:
        - and:
            - text: { must_match: "draft|report" }
            - tool_names: { some: { must_match: "generate_urls" } }
        - and:
            - text: { must_match: "clarif|which|specify" }
            - tools: { count: { exact: 0 } }
```

### S9: Multi-turn with forbidden tools

```yaml
turns:
  - user: "Tell me about Katalon TestOps"
    assert:
      tools:
        count: { exact: 0 }
      text:
        must_match: "Kai"
  - user: "Find test results for project ${ENV.PROJECT_ID}"
    assert:
      tool_names:
        ordered:
          - equals: "intent_agent"
          - equals: "find_iterations"
          - equals: "generate_urls"
        none: { must_match: "stability_.*" }
      text:
        must_match: "http"
      duration_ms:
        max: 30000
```

### Require pattern: tool called N times with specific args

```yaml
# "search" called exactly 2 times with query matching "weather"
assert:
  tools:
    filter:
      match:
        name: { equals: "search" }
        args.query: { must_match: "weather" }
    count: { exact: 2 }
```

### Forbid pattern: block specific tool+args combination

```yaml
# Forbid database_query on users table returning passwords
assert:
  tools:
    none:
      match:
        name: { equals: "database_query" }
        args.table: { equals: "users" }
        result:
          json:
            match:
              data: { must_match: "password" }
```

### JSON tool results

```yaml
# Assert on parsed JSON in tool result
assert:
  tools:
    some:
      match:
        name: { equals: "get_report" }
        result:
          json:
            match:
              status: { equals: "ok" }
              items: { count: { min: 1 } }
              score:
                min: 80
                max: 100
```

### Complex filter + assertions on filtered results

```yaml
# Of all get_* tools, at least 3 exist, and all returned success
assert:
  tools:
    filter:
      match:
        name: { must_match: "get_.*" }
    count: { min: 3 }
    every:
      match:
        result:
          json:
            match:
              status: { equals: "success" }
```
