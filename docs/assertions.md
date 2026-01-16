# Assertions

Assertions validate the behavior of your AG-UI agent during tests. They can be defined at three levels with inheritance:

- **Target-level** (`target.assert` in config): Default assertions for all tests
- **Test-level** (`assert` at test root): Inherits from target, applies after all turns
- **Turn-level** (`assert` under turn): Inherits from target and test, applies immediately

## Assertion Inheritance

Assertions inherit from higher levels and can be overridden:

- **Scalars** (timing values): Higher level overrides lower
- **`false`**: Disables an inherited constraint
- **Arrays** (forbid, require, must_match): Accumulate from all levels

## Assertion Categories

### Tools

Validate tool usage patterns.

#### `forbid`

Fail if any of the listed tools are called.

```yaml
assert:
  tools:
    forbid:
      - dangerous_tool
      - deprecated_tool
```

#### `require`

Require specific tools to be called with optional constraints.

```yaml
assert:
  tools:
    require:
      - name: search
        count:
          min: 1
          max: 3
        args_match:
          query: "weather.*"
        result_match: "success"
        result_not_match: "error"
        after: authenticate
```

**Options:**

| Field              | Description                              |
| ------------------ | ---------------------------------------- |
| `name`             | Tool name (required)                     |
| `count`            | Call count constraint (default: min 1)   |
| `args_match`       | Regex patterns to filter by arguments    |
| `result_match`     | Regex pattern to filter by result        |
| `result_not_match` | Regex pattern to exclude by result       |
| `after`            | Tool must be called after this tool      |

**How filtering works:**

The `args_match`, `result_match`, and `result_not_match` options filter the tool calls. The `count` constraint is then applied to the filtered calls. By default, at least 1 matching call is required.

```yaml
# Passes if at least 1 call has query matching "weather"
require:
  - name: search
    args_match:
      query: "weather"

# Passes if exactly 2 calls have query matching "weather"
require:
  - name: search
    args_match:
      query: "weather"
    count:
      exact: 2
```

**Count constraints:**

```yaml
# Exact count
count:
  exact: 2

# Range
count:
  min: 1
  max: 5
```

**Nested argument matching:**

Use dot notation to match nested object properties:

```yaml
args_match:
  user.name: "John"
  user.address.city: "Paris"
  config.settings.enabled: "true"
```

For an argument like:

```json
{
  "user": {
    "name": "John Doe",
    "address": { "city": "Paris" }
  }
}
```

#### `forbid_calls`

Forbid specific tool calls based on conditions (more granular than `forbid`).

```yaml
assert:
  tools:
    forbid_calls:
      - name: database_query
        args_match:
          table: "users"
        result_match: "password"
```

This fails if `database_query` is called with `table` matching "users" AND result matching "password".

## Regex Patterns

All pattern matching (`args_match`, `result_match`, `must_match`, etc.) uses regex. By default, patterns are case-sensitive.

**Regex flags:**

Use `/pattern/flags` syntax for regex flags:

```yaml
args_match:
  name: "/john/i"              # case insensitive
  email: "john@example\\.com"  # default (case sensitive)

text:
  must_match: "/hello.*world/i"  # case insensitive
```

Supported flags: `g` (global), `i` (case insensitive), `m` (multiline), `s` (dotall), `u` (unicode), `y` (sticky).

### Text

Validate assistant response text.

```yaml
assert:
  text:
    must_match: "hello.*world"
    must_not_match: ["error", "failed", "exception"]
```

| Field            | Description                                         |
| ---------------- | --------------------------------------------------- |
| `must_match`     | Regex (or array) that must match assistant text     |
| `must_not_match` | Regex (or array) that must NOT match assistant text |

Both fields accept a single string or an array of strings. Arrays accumulate across inheritance levels.

For test-level assertions, text from all turns is combined with newlines.

### Timing

Validate execution timing.

```yaml
assert:
  timing:
    max_duration_ms: 5000
    max_idle_ms: 1000
```

| Field             | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| `max_duration_ms` | Maximum total duration in milliseconds                                           |
| `max_idle_ms`     | Maximum idle time (start-to-first-tool, between tools, last-tool-to-end)         |

Use `false` to disable an inherited timing constraint:

```yaml
assert:
  timing:
    max_idle_ms: false  # Disable inherited idle check
```

## Turn vs Test Level

**Turn-level assertions** are evaluated immediately after each turn. If a turn assertion fails, the test stops.

```yaml
turns:
  - user: "Search for weather"
    assert:
      tools:
        require:
          - name: search
```

**Test-level assertions** are evaluated after all turns complete. They operate on aggregated data from all turns.

```yaml
turns:
  - user: "Hello"
  - user: "Search for weather"
assert:
  tools:
    require:
      - name: search
  timing:
    max_duration_ms: 10000
```

## Examples

### Require tool with argument validation

```yaml
turns:
  - user: "Book a flight to Paris"
    assert:
      tools:
        require:
          - name: book_flight
            args_match:
              destination: "Paris"
```

### Ensure tool ordering

```yaml
turns:
  - user: "Process payment"
    assert:
      tools:
        require:
          - name: charge_card
            after: validate_card
```

### Validate response content

```yaml
turns:
  - user: "What is 2+2?"
    assert:
      text:
        must_match: "4"
        must_not_match: "I don't know"
```

### Performance constraints

```yaml
name: Fast response test
turns:
  - user: "Quick question"
assert:
  timing:
    max_duration_ms: 3000
```

### Forbid dangerous patterns

```yaml
turns:
  - user: "Delete my account"
    assert:
      tools:
        forbid:
          - delete_all_data
        forbid_calls:
          - name: database_query
            args_match:
              operation: "DELETE"
```

### Nested argument matching

```yaml
turns:
  - user: "Create user John in Paris"
    assert:
      tools:
        require:
          - name: create_user
            args_match:
              user.name: "John"
              user.address.city: "Paris"
```
