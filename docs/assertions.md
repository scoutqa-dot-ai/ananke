# Assertions

Assertions validate the behavior of your AG-UI agent during tests. They can be applied at two levels:

- **Turn-level**: Applied to a single turn (user message or connect)
- **Test-level**: Applied across all turns in the test

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
| `count`            | Call count constraint                    |
| `args_match`       | Regex patterns for arguments             |
| `result_match`     | Regex pattern that result must match     |
| `result_not_match` | Regex pattern that result must not match |
| `after`            | Tool must be called after this tool      |

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

### Text

Validate assistant response text.

```yaml
assert:
  text:
    must_match: "hello.*world"
    must_not_match: "error|failed"
```

| Field            | Description                           |
| ---------------- | ------------------------------------- |
| `must_match`     | Regex pattern the text must match     |
| `must_not_match` | Regex pattern the text must not match |

For test-level assertions, text from all turns is combined with newlines.

### Timing

Validate execution timing.

```yaml
assert:
  timing:
    max_duration_ms: 5000
    max_gap_ms: 1000
```

| Field             | Description                                |
| ----------------- | ------------------------------------------ |
| `max_duration_ms` | Maximum total duration in milliseconds     |
| `max_gap_ms`      | Maximum gap between consecutive tool calls |

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
