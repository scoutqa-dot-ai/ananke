# AG-UI Testing MVP

## What This Product Is

An assertion-based testing tool for tool-using AI apps that:

- Runs scripted multi-step conversations against AG-UI endpoints over SSE
- Observes tool calls (name, args, result, timing) and assistant text
- Evaluates deterministic assertions (no LLM-as-judge)
- Produces binary PASS / FAIL for CI

---

## Core Principles

- Tools are the primary oracle
- Text is secondary, regex-based
- Fail fast on step-level violations
- Deterministic CI semantics

---

## Config

One config per project. Defines the target endpoint and named assertions.

```yaml
version: "1.0"

target:
  type: agui
  endpoint: "https://app.example.com/ag-ui"
  agentId: "my-agent"
  headers:
    Authorization: "Bearer ${ENV.TOKEN}"
  timeout_ms: 30000

assertions:
  fast_response:
    response:
      having:
        durationMs: { max: 15000 }
```

---

## Test File

A test file has a name and a list of steps. Each step is one of:

- **`message`** — send a message to the agent
- **`script`** — run a command, set variables (no agent call)
- **`resume`** — reconnect to an existing thread by ID

Assertions live on steps using `expect:`. No test-level or target-level assertions.

```yaml
version: "1.0"
name: checkout flow

steps:
  - script: "scripts/seed-cart.sh"

  - message: "I want to checkout"
    expect:
      tool_names:
        ordered:
          - equals: "validate_cart"
          - equals: "get_shipping_options"
      response:
        having:
          durationMs: { max: 30000 }

  - message: "Use the first shipping option"
    expect:
      tool_names:
        some: { equals: "calculate_total" }

  - message: "Confirm and pay"
    expect:
      tools:
        filter:
          having:
            name: { equals: "charge_card" }
        count: { equals: 1 }
      text:
        not:
          matches: "error|failed"
```

---

## Execution Model

For each test file:

1. Load config
2. Execute steps sequentially:
   - Script steps: run command, merge output variables
   - Message/resume steps: create client (if needed), send message or resume
3. For each agent-facing step:
   - Collect tool calls and assistant text
   - Evaluate `expect:` assertions (if any)
   - On failure → FAIL immediately
4. All steps pass → PASS

---

## Captured Data

Per agent-facing step:

- Ordered list of tool calls (`name`, `args`, `result`, `timestamp`)
- Assistant text
- `startTs` / `endTs` (Unix ms)

---

## Thread ID

Thread ID is managed through context variables, not config:

- First `message` step auto-generates `THREAD_ID` if not set
- `resume` step sets `THREAD_ID` from its value
- Scripts can set/override via `{ "variables": { "THREAD_ID": "..." } }`
- Available as `${VAR.THREAD_ID}` in messages

---

## Future Work

- **A2A** (`type: a2a`) — Agent-to-Agent protocol
- **MCP** (`type: mcp`) — Model Context Protocol
