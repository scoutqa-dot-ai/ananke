# Recording and Replay

Record AG-UI events from remote server, then replay locally to iterate on assertions without repeated remote calls.

## Use Cases

- Remote server is slow or expensive to run
- Iterating on assertions without waiting for agent responses
- Debugging test failures with captured event data
- Sharing test recordings for collaboration

## Workflow

1. **Record**: Run tests against remote server, save events to directory
2. **Replay**: Run assertions against saved events (no remote calls)
3. **Iterate**: Adjust assertions, replay, repeat

## Usage

```bash
# Record events from remote server
ananke run --record ./recordings/

# Replay from saved events
ananke run --replay ./recordings/
```

## Directory Structure

Events are organized by test file path and turn:

```
recordings/
  tests/
    v0-login-form-app.test.yaml/
      script-step-0.json
      turn-0.jsonl
      turn-1.jsonl
    other/
      nested.test.yaml/
        turn-0.jsonl
```

- Turn files contain AG-UI events in JSONL format (one event per line)
- Script step files store output variables as JSON

## Notes

- `--record` and `--replay` are mutually exclusive
- Script steps are re-executed during replay (to restore variables); only agent responses come from recordings
- Test file path is used as directory structure (mirrors source layout)
