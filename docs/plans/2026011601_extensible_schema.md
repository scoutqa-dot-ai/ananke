# Extensible Schema Implementation Plan

> **Status:** ✅ Implemented
> **Target Version:** 1.0 (schema versioning foundation)
> **Completed:** 2026-01-16

## Overview

Refactor the YAML schema to support versioning and protocol extensibility. This enables adding A2A and MCP protocols as minor version updates (1.1, 1.2) without breaking existing configurations.

## Goals

1. Add `version` field to config and test files
2. Add `type` discriminator to target config (flat structure, all fields at same level)
3. Make `text.must_match` / `must_not_match` accept arrays
4. Add assertion inheritance at all three levels:
   - Target level (`target.assert`) - defaults for all tests
   - Test level (`assert` at test root) - overrides target
   - Turn level (`assert` under turn) - overrides test
   - Scalars override, arrays extend, `false` disables
5. Rename `max_gap_ms` to `max_idle_ms` (fix idle gap coverage)

## Design Principle

All discriminated unions use flat structure with `type` as discriminator:

```yaml
# Target config
target:
  type: agui # Discriminator
  endpoint: "..." # Type-specific field (same level)
  agentId: "..." # Type-specific field (same level)

# Turn
turns:
  - type: user # Discriminator
    user: "message" # Type-specific field (same level)
```

This enables TypeScript type narrowing and keeps YAML readable.

## Non-Goals

- Implementing A2A or MCP clients (future work)
- Changing assertion logic
- Breaking existing configurations

---

## Implementation Steps

### Phase 1: Schema Updates

#### 1.1 Update `src/types/config.ts`

Add versioned config schema with `type` discriminator using flat structure:

```typescript
// AssertBlock schema (used at target, test, and turn levels)
const TimingSchema = z.object({
  max_duration_ms: z.union([z.number(), z.literal(false)]).optional(),
  max_idle_ms: z.union([z.number(), z.literal(false)]).optional(),
});

const AssertBlockSchema = z.object({
  tools: ToolsAssertSchema.optional(),
  timing: TimingSchema.optional(),
  text: TextAssertSchema.optional(),
});

// Common fields shared across all target types
const CommonTargetFields = {
  headers: z.record(z.string()).optional(),
  timeout_ms: z.number().optional(),
  assert: AssertBlockSchema.optional(), // Default assertions for all tests
};

// AG-UI target (flat - all fields at same level as type)
const AGUITargetSchema = z.object({
  type: z.literal("agui"),
  ...CommonTargetFields,
  // AG-UI specific fields
  endpoint: z.string().url(),
  agentId: z.string(),
  threadId: z.string().optional(),
  forwardedProps: z.record(z.unknown()).optional(),
  state: z.record(z.unknown()).optional(),
});

// Future: A2A target
// const A2ATargetSchema = z.object({
//   type: z.literal("a2a"),
//   ...CommonTargetFields,
//   agentCardUrl: z.string().url().optional(),
//   endpoint: z.string().url().optional(),
//   contextId: z.string().optional(),
//   ...
// });

// Discriminated union on "type" field
const TargetSchema = z.discriminatedUnion("type", [
  AGUITargetSchema,
  // A2ATargetSchema,
  // MCPTargetSchema,
]);

export const ProjectConfigSchema = z.object({
  version: z.string().default("1.0"),
  target: TargetSchema,
});

// Type exports
export type AGUITarget = z.infer<typeof AGUITargetSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
```

Note: Using flat discriminated union - all fields at same level as `type`. This pattern is consistent with turn types and enables proper Zod type narrowing.

**Files:** `src/types/config.ts`

#### 1.2 Update `src/types/test.ts`

Add version field and update text assertions to accept arrays:

```typescript
// Text assertions accept string or array
const TextAssertSchema = z.object({
  must_match: z.union([z.string(), z.array(z.string())]).optional(),
  must_not_match: z.union([z.string(), z.array(z.string())]).optional(),
});

export const TestFileSchema = z.object({
  version: z.string().default("1.0"),
  name: z.string(),
  hooks: z.array(HookSchema).optional(),
  turns: z.array(TurnSchema).min(1),
  assert: AssertBlockSchema.optional(),
});
```

**Files:** `src/types/test.ts`

---

### Phase 2: Config Loader Updates

#### 2.1 Update config loader in `src/config/loader.ts`

Simple validation with Zod:

```typescript
function loadConfig(raw: unknown): ProjectConfig {
  return ProjectConfigSchema.parse(raw);
}
```

**Files:** `src/config/loader.ts`

#### 2.2 Update interpolation

Interpolation already works on flat structure (no changes needed).

**Files:** `src/config/interpolate.ts` (verify, likely no changes)

---

### Phase 3: Client Factory

#### 3.1 Create protocol client factory in `src/client/index.ts`

Abstract client creation based on target type:

```typescript
export function createClient(config: ProjectConfig): ProtocolClient {
  const target = config.target;

  switch (target.type) {
    case "agui":
      // TypeScript narrows target to AGUITarget here
      return new AGUIClient({
        endpoint: target.endpoint,
        agentId: target.agentId,
        headers: target.headers,
        threadId: target.threadId,
        forwardedProps: target.forwardedProps,
        state: target.state,
        timeout_ms: target.timeout_ms,
      });

    // Future target types
    // case 'a2a':
    //   // target is narrowed to A2ATarget
    //   return new A2AClient({ ... });
    // case 'mcp':
    //   // target is narrowed to MCPTarget
    //   return new MCPClient({ ... });

    default:
      // Exhaustive check
      const _exhaustive: never = target;
      throw new Error(`Unknown target type: ${(_exhaustive as any).type}`);
  }
}
```

Note: With flat discriminated union, TypeScript automatically narrows the type after the switch statement, giving type-safe access to protocol-specific fields.

**Files:** `src/client/index.ts`, `src/client/types.ts`

#### 3.2 Define ProtocolClient interface

Common interface for all protocol clients:

```typescript
export interface ProtocolClient {
  sendMessage(options: SendMessageOptions): AsyncGenerator<ProtocolEvent>;
  connect?(): AsyncGenerator<ProtocolEvent>;
  close?(): Promise<void>;
}

export interface ProtocolEvent {
  type: string;
  // Common event fields
}
```

**Files:** `src/client/types.ts`

---

### Phase 4: Assertion Updates

#### 4.1 Update text assertions to handle arrays

Modify `src/assertions/text.ts` to normalize string to array:

```typescript
function normalizeToArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function evaluateTextAssertions(
  text: string,
  assertions: TextAssert
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const pattern of normalizeToArray(assertions.must_match)) {
    // Evaluate each pattern
  }

  for (const pattern of normalizeToArray(assertions.must_not_match)) {
    // Evaluate each pattern
  }

  return results;
}
```

**Files:** `src/assertions/text.ts`

#### 4.2 Update text assertion tests

Add test cases for array format.

**Files:** `src/assertions/text.test.ts`

#### 4.3 Refactor timing assertions

Rename `max_gap_ms` to `max_idle_ms` and fix gap coverage:

```typescript
// src/assertions/timing.ts
export interface TimingConstraints {
  max_duration_ms?: number | false;
  max_idle_ms?: number | false;
}

export function assertTiming(
  context: TimingContext,
  constraints: TimingConstraints
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Check max duration (skip if false)
  if (constraints.max_duration_ms && constraints.max_duration_ms !== false) {
    const duration = context.endTs - context.startTs;
    if (duration > constraints.max_duration_ms) {
      results.push({ passed: false, assertion: 'Duration constraint', ... });
    }
  }

  // Check max idle (skip if false)
  if (constraints.max_idle_ms && constraints.max_idle_ms !== false) {
    // Check ALL gaps including start-to-first and last-to-end
    const gaps = computeIdleGaps(context);
    for (const gap of gaps) {
      if (gap.duration > constraints.max_idle_ms) {
        results.push({ passed: false, assertion: 'Idle constraint', ... });
      }
    }
  }

  return results;
}

function computeIdleGaps(context: TimingContext): Array<{from: string, to: string, duration: number}> {
  const gaps = [];
  const sorted = [...context.toolCalls].sort((a, b) => a.timestamp - b.timestamp);

  // Gap from start to first tool call
  if (sorted.length > 0) {
    gaps.push({ from: 'start', to: sorted[0].name, duration: sorted[0].timestamp - context.startTs });
  }

  // Gaps between tool calls
  for (let i = 1; i < sorted.length; i++) {
    gaps.push({
      from: sorted[i-1].name,
      to: sorted[i].name,
      duration: sorted[i].timestamp - sorted[i-1].timestamp
    });
  }

  // Gap from last tool call to end
  if (sorted.length > 0) {
    const last = sorted[sorted.length - 1];
    gaps.push({ from: last.name, to: 'end', duration: context.endTs - last.timestamp });
  }

  // If no tool calls, entire duration is idle
  if (sorted.length === 0) {
    gaps.push({ from: 'start', to: 'end', duration: context.endTs - context.startTs });
  }

  return gaps;
}
```

**Files:** `src/assertions/timing.ts`

#### 4.4 Add assertion inheritance in runner

Merge assertions from target -> test -> turn:

```typescript
// src/runner/merge.ts
function mergeAssertBlocks(
  target: AssertBlock | undefined,
  test: AssertBlock | undefined,
  turn: AssertBlock | undefined
): AssertBlock {
  return {
    tools: mergeToolsAssert(target?.tools, test?.tools, turn?.tools),
    timing: mergeTimingAssert(target?.timing, test?.timing, turn?.timing),
    text: mergeTextAssert(target?.text, test?.text, turn?.text),
  };
}

// Scalars: override (higher level wins)
// false: disable the constraint
function mergeTimingAssert(
  ...levels: (TimingConstraints | undefined)[]
): TimingConstraints {
  const merged: TimingConstraints = {};
  for (const level of levels) {
    if (level?.max_duration_ms !== undefined)
      merged.max_duration_ms = level.max_duration_ms;
    if (level?.max_idle_ms !== undefined)
      merged.max_idle_ms = level.max_idle_ms;
  }
  return merged;
}

// Arrays: extend (accumulate from all levels)
function mergeToolsAssert(...levels: (ToolsAssert | undefined)[]): ToolsAssert {
  const merged: ToolsAssert = { forbid: [], require: [], forbid_calls: [] };
  for (const level of levels) {
    if (level?.forbid) merged.forbid.push(...level.forbid);
    if (level?.require) merged.require.push(...level.require);
    if (level?.forbid_calls) merged.forbid_calls.push(...level.forbid_calls);
  }
  return merged;
}

// Arrays: extend (accumulate from all levels)
function mergeTextAssert(...levels: (TextAssert | undefined)[]): TextAssert {
  const merged: TextAssert = { must_match: [], must_not_match: [] };
  for (const level of levels) {
    if (level?.must_match)
      merged.must_match.push(...normalizeToArray(level.must_match));
    if (level?.must_not_match)
      merged.must_not_match.push(...normalizeToArray(level.must_not_match));
  }
  return merged;
}
```

**Files:** `src/runner/merge.ts` (new), `src/runner/test.ts`, `src/runner/turn.ts`

#### 4.5 Update assertion tests

Add test cases for:

- `max_idle_ms` covering all gaps (start-to-first, between, last-to-end)
- `false` to disable inherited constraints
- Assertion inheritance (target -> test -> turn)
- Array accumulation (forbid, require, must_match)

**Files:** `src/assertions/timing.test.ts`

---

### Phase 5: Runner Updates

#### 5.1 Update test runner to use client factory

Replace direct AGUIClient instantiation with factory:

```typescript
// Before
const client = new AGUIClient({ endpoint, agentId, headers });

// After
const client = createClient(config);
```

**Files:** `src/runner/test.ts`

---

### Phase 6: Examples and Documentation

#### 6.1 Update example files

Add `version` field to example YAML files:

**Files:** `examples/checkout.test.yaml`

#### 6.2 Update ananke.config.yaml template

If a template/example config exists, update it.

---

## Testing Checklist

- [x] Config with `version: "1.0"` and `type: agui` loads correctly
- [x] Target-level `assert` block works as defaults
- [x] Text assertions with array work
- [x] Timing: `max_idle_ms` checks all gaps (start-to-first, between, last-to-end)
- [x] Timing: `false` disables inherited constraint
- [x] Inheritance: target -> test -> turn for all assertion types
- [x] Inheritance: scalars override (timing values)
- [x] Inheritance: arrays extend (forbid, require, must_match accumulate)
- [x] All existing unit tests pass (72 tests)
- [x] Example test files updated

---

## File Change Summary

| File                            | Change Type | Status | Description                                                       |
| ------------------------------- | ----------- | ------ | ----------------------------------------------------------------- |
| `src/types/config.ts`           | Modify      | ✅     | Add version, `assert` block, flat discriminated union with `type` |
| `src/types/test.ts`             | Modify      | ✅     | Add version, text assertions accept arrays                        |
| `src/config/loader.ts`          | Verify      | ✅     | Already uses Zod validation (no changes needed)                   |
| `src/config/interpolate.ts`     | Verify      | ✅     | Works with flat structure (no changes needed)                     |
| `src/client/index.ts`           | Modify      | ✅     | Add createClient factory                                          |
| `src/client/types.ts`           | New         | ✅     | Define ProtocolClient interface                                   |
| `src/assertions/text.ts`        | Modify      | ✅     | Handle array text assertions                                      |
| `src/assertions/text.test.ts`   | Modify      | ✅     | Add array test cases                                              |
| `src/assertions/timing.ts`      | Modify      | ✅     | Rename to `max_idle_ms`, fix gap coverage, support `false`        |
| `src/assertions/timing.test.ts` | Modify      | ✅     | Add tests for idle gaps, `false` disable                          |
| `src/runner/merge.ts`           | New         | ✅     | Assertion inheritance logic (target -> test -> turn)              |
| `src/runner/merge.test.ts`      | New         | ✅     | Tests for assertion merge logic                                   |
| `src/runner/test.ts`            | Modify      | ✅     | Use client factory, use merged assertions                         |
| `src/runner/turn.ts`            | Modify      | ✅     | Use ProtocolClient interface                                      |
| `src/runner/index.ts`           | Modify      | ✅     | Export merge module                                               |
| `examples/checkout.test.yaml`   | Modify      | ✅     | Add version, use `max_idle_ms`                                    |
| `ananke.config.yaml`            | Modify      | ✅     | Add version, type, agentId                                        |
| `README.md`                     | Modify      | ✅     | Update examples and docs                                          |
| `docs/assertions.md`            | Modify      | ✅     | Document inheritance, max_idle_ms, arrays                         |
| `docs/mvp.md`                   | Modify      | ✅     | Update spec for new schema                                        |

---

## Rollout Plan

1. ✅ Implement all changes
2. ✅ Run full test suite (72 tests passing)
3. ✅ Update example files to new schema
4. Release

### Git Commits

1. `refactor: update schema for extensibility and 3-level assertions`
2. `docs: update spec for extensible schema and 3-level assertions`
3. `feat: add protocol client factory for extensibility`
4. `feat: add assertion inheritance and array text patterns`
5. `refactor: integrate client factory and assertion merge in runner`
6. `docs: update examples and docs for new schema`

---

## Future Work (Out of Scope)

These items are enabled by this refactor but not implemented:

### Protocol Adapters

- A2A client implementation (`src/client/a2a.ts`)
- MCP client implementation (`src/client/mcp.ts`)
- A2A/MCP-specific turn types
- A2A Agent Card fetching and parsing
- MCP capability negotiation

### Reusable Assertion Blocks (`extends`)

Allow tests to reference shared assertion definitions:

```yaml
# ananke.config.yaml
assertions:
  no_errors:
    text:
      must_not_match: ["error", "failed"]

# test.yaml
turns:
  - user: "checkout"
    assert:
      extends: [no_errors]
      tools:
        require:
          - name: charge_card
```

This would reduce duplication across test files.
