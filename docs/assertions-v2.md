# Assertions v2

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
| `json` | string → any | Parse JSON string into structured data |
| `filter` | array → array | Keep elements matching a predicate, assert on sub-array |
| `having` | object → (shorthand) | Dot-path keys for multiple field assertions on an object |

**Note:** `filter` (listed under Array assertions) and `having` (listed under Object assertions) appear in both tables for discoverability, but they are transforms — they reshape data and delegate to nested assertions. They do not produce pass/fail themselves.

Inside `having`, every key is interpreted as a dot-path into the object, never as an assertion operator. Even if an object has a field named `count` or `some`, `having` treats it as a field path, not an operator.

### Assertions

Assertions evaluate a value and produce pass/fail.

**String** — applies when value is a string:

| Operator | Description |
|---|---|
| `equals` | Exact string match |
| `contains` | Substring match |
| `starts_with` | String prefix match |
| `ends_with` | String suffix match |
| `matches` | Regex pattern(s) that must all match |

All regex operators accept a single string or array of strings. Patterns use `/pattern/flags` syntax for regex flags (e.g. `/hello/i`).

**Number** — applies when value is a number:

| Operator | Description |
|---|---|
| `equals` | Equals this value |
| `min` | Greater than or equal to |
| `max` | Less than or equal to |

**Array** — applies when value is an array:

| Operator | Description |
|---|---|
| `contains` | Element exists in the array (sugar for `some: { equals: X }`) |
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
| `having` | Transform: dot-path shorthand for multiple field assertions (implicit AND) |

Use `not: { has_key: "x" }` to assert a key does not exist.

**Meta** — applies to any type:

| Operator | Description |
|---|---|
| `and` | All assertions must pass |
| `or` | At least one assertion must pass |
| `not` | Invert the result |

Multiple keys at the same level are implicitly ANDed.

## Error Aggregation

When `and` (or implicit AND from multiple sibling keys) has multiple children and several fail, all failures are reported — not just the first. This gives the most actionable output.

## Type Checking

Operators are type-specific. If an operator receives a value of the wrong type, the assertion **fails** with a clear error message describing the mismatch.

For selectors, the type is always known:
- `text` always produces a string
- `tools` always produces an array
- `duration_ms` always produces a number

For transforms, the output type depends on the data at runtime:
- `json` parses a string into any type (object, array, number, string, boolean)
- `having` extracts values of any type from an object

When a type mismatch occurs, the assertion result includes:
- The operator that failed
- The expected type(s)
- The actual type and value received
- The path through selectors/transforms that produced the value

```yaml
# Example error output:
# FAIL: "min" expects number but got string
#   at: tools → filter → having → result → json → status
#   value: "ok"
#   hint: use "equals", "contains", or "matches" for string values
```

This is a runtime check, not a schema validation. The assertion fails like any other failed assertion — it appears in the test results with a clear reason.

### Null and Boolean Values

`json` can parse `null`, `true`, `false`. Boolean and null values support `equals` only (strict equality). Any other operator on a boolean/null value produces a type mismatch failure.

```yaml
# Example error output:
# FAIL: "matches" expects string but got boolean
#   at: tools → some → having → result → json → active
#   value: true
#   hint: use "equals" for boolean values
```

## Transforms in Detail

### `json` — parse JSON string

Parse a string value as JSON, then apply assertions on the parsed result. The parsed value can be any JSON type (object, array, number, string, boolean, null).

```yaml
# Parse tool result as JSON object, assert on fields
tools:
  some:
    having:
      name: { equals: "search" }
      result:
        json:
          having:
            status: { equals: "ok" }
            items: { count: { min: 1 } }

# Parse as JSON array
tools:
  some:
    having:
      name: { equals: "list_items" }
      result:
        json:
          count: { min: 3 }
          every: { matches: "http.*" }

# Parse as JSON number
tools:
  some:
    having:
      name: { equals: "get_score" }
      result:
        json:
          min: 80
          max: 100
```

If the value is not a valid JSON string, the assertion fails with "invalid JSON".

### `filter` — keep matching elements

Filter an array to elements matching a predicate, then apply assertions on the resulting sub-array. The predicate uses the same assertion syntax.

**Empty results:** `filter` always succeeds as a transform — it yields the (possibly empty) sub-array to downstream assertions. `every` on an empty array passes (vacuous truth). Use `count: { min: 1 }` alongside `filter` if you need to ensure at least one element matched.

**Evaluation order:** When `filter` appears alongside other keys (like `count`, `every`) in an array context, `filter` runs first and its output replaces the input for all sibling assertions. This is the only case where sibling keys do not all receive the same input.

```yaml
# Count tools matching a name
tools:
  filter:
    having:
      name: { equals: "search" }
  count: { equals: 2 }

# Filter by multiple conditions, then assert on results
tools:
  filter:
    having:
      name: { equals: "search" }
      args.query: { matches: "weather" }
  count: { equals: 2 }
  every:
    having:
      result:
        json:
          having:
            status: { equals: "ok" }
```

### `having` — dot-path shorthand

Apply assertions to multiple fields of an object using dot-notation keys. Multiple keys are implicitly ANDed. Supports array indexing with `[]` notation.

```yaml
# Assert on multiple fields
tools:
  some:
    having:
      name: { equals: "search" }
      args.query: { matches: "weather" }

# Array indexing
tools:
  some:
    having:
      args.items[0]: { equals: "first" }
```

Inside `having`, every key is interpreted as a dot-path into the object. This avoids ambiguity with assertion operator names — `having` keys are always paths, never operators.

## Examples

### S1: Pure conversation, no tools

```yaml
assert:
  text:
    matches:
      - "Kai"
      - "TestOps|TrueTest"
  tools:
    count: { equals: 0 }
```

### S2: Single tool use

```yaml
turns:
  - user: "What's the status of project P1?"
    assert:
      tool_names:
        some: { equals: "get_project_status" }
      text:
        matches: "status"
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
        some: { matches: "get_.*_insights" }
        none: { matches: "stability_.*" }
        count: { min: 3 }
      text:
        matches: "report|analysis|insight"
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
        matches: "http"
```

### S8: Branching response (clarification vs draft)

```yaml
turns:
  - user: "Generate report"
    assert:
      or:
        - and:
            - text: { matches: "draft|report" }
            - tool_names: { some: { matches: "generate_urls" } }
        - and:
            - text: { matches: "clarif|which|specify" }
            - tools: { count: { equals: 0 } }
```

### S9: Multi-turn with forbidden tools

```yaml
turns:
  - user: "Tell me about Katalon TestOps"
    assert:
      tools:
        count: { equals: 0 }
      text:
        matches: "Kai"
  - user: "Find test results for project ${ENV.PROJECT_ID}"
    assert:
      tool_names:
        ordered:
          - equals: "intent_agent"
          - equals: "find_iterations"
          - equals: "generate_urls"
        none: { matches: "stability_.*" }
      text:
        matches: "http"
      duration_ms:
        max: 30000
```

### Array contains — quick element check

```yaml
# Simple: is "search" in the tool names?
assert:
  tool_names:
    contains: "search"

# Equivalent to:
assert:
  tool_names:
    some: { equals: "search" }
```

### Require pattern: tool called N times with specific args

```yaml
# "search" called exactly 2 times with query matching "weather"
assert:
  tools:
    filter:
      having:
        name: { equals: "search" }
        args.query: { matches: "weather" }
    count: { equals: 2 }
```

### Forbid pattern: block specific tool+args combination

```yaml
# Forbid database_query on users table returning passwords
assert:
  tools:
    none:
      having:
        name: { equals: "database_query" }
        args.table: { equals: "users" }
        result:
          json:
            having:
              data: { matches: "password" }
```

### JSON tool results

```yaml
# Assert on parsed JSON in tool result
assert:
  tools:
    some:
      having:
        name: { equals: "get_report" }
        result:
          json:
            having:
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
      having:
        name: { matches: "get_.*" }
    count: { min: 3 }
    every:
      having:
        result:
          json:
            having:
              status: { equals: "success" }
```

### Negation with `not`

```yaml
# Text must NOT match a pattern (replaces must_not_match)
assert:
  text:
    not:
      matches: "def sort|sorted\\("

# Key must NOT exist (replaces not_has_key)
assert:
  tools:
    some:
      not:
        has_key: "error"
```
