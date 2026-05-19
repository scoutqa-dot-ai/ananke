import { describe, it, expect } from "vitest";
import { findRunStartIndex, historyEventsToRawAGUI } from "./aguiwss.js";

describe("findRunStartIndex", () => {
  it("returns history.length when userMessage is null (resume case)", () => {
    const history = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", sourceMessageId: "m1" },
    ];
    expect(findRunStartIndex(history, null)).toBe(2);
  });

  it("returns index right after the matching user message", () => {
    const history = [
      { role: "user", content: "first turn" },
      { role: "assistant", content: "reply 1", sourceMessageId: "m1" },
      { role: "user", content: "second turn" },
      { role: "assistant", content: "reply 2", sourceMessageId: "m2" },
    ];
    expect(findRunStartIndex(history, "second turn")).toBe(3);
  });

  it("prefers the most recent occurrence when text repeats", () => {
    const history = [
      { role: "user", content: "ping" },
      { role: "assistant", content: "pong 1", sourceMessageId: "m1" },
      { role: "user", content: "ping" },
      { role: "assistant", content: "pong 2", sourceMessageId: "m2" },
    ];
    expect(findRunStartIndex(history, "ping")).toBe(3);
  });

  it("returns history.length when no match (safer to recover nothing)", () => {
    const history = [
      { role: "user", content: "different" },
      { role: "assistant", content: "reply", sourceMessageId: "m1" },
    ];
    expect(findRunStartIndex(history, "not present")).toBe(2);
  });
});

describe("historyEventsToRawAGUI", () => {
  it("translates assistant content to TEXT_MESSAGE_CONTENT with cumulative delta", () => {
    const out = historyEventsToRawAGUI([
      { role: "assistant", content: "hello world", sourceMessageId: "msg-123" },
    ]);
    expect(out).toEqual([
      {
        type: "TEXT_MESSAGE_CONTENT",
        eventId: "history:msg:msg-123",
        messageId: "msg-123",
        delta: "hello world",
      },
    ]);
  });

  it("translates tool invocation to TOOL_CALL_START + ARGS + END", () => {
    const out = historyEventsToRawAGUI([
      {
        role: "tool",
        toolCalls: [
          { id: "tc1", type: "function", function: { name: "my_tool", arguments: '{"x":1}' } },
        ],
      },
    ]);
    expect(out).toEqual([
      { type: "TOOL_CALL_START", eventId: "history:tcs:tc1", toolCallId: "tc1", toolCallName: "my_tool" },
      { type: "TOOL_CALL_ARGS", eventId: "history:tca:tc1", toolCallId: "tc1", delta: '{"x":1}' },
      { type: "TOOL_CALL_END", eventId: "history:tce:tc1", toolCallId: "tc1" },
    ]);
  });

  it("omits TOOL_CALL_ARGS when arguments is empty/missing", () => {
    const out = historyEventsToRawAGUI([
      {
        role: "tool",
        toolCalls: [{ id: "tc2", function: { name: "no_arg_tool" } }],
      },
    ]);
    expect(out.map((e) => e.type)).toEqual(["TOOL_CALL_START", "TOOL_CALL_END"]);
  });

  it("translates tool result to TOOL_CALL_RESULT", () => {
    const out = historyEventsToRawAGUI([
      { role: "tool", toolCallId: "tc1", content: '"ok"' },
    ]);
    expect(out).toEqual([
      {
        type: "TOOL_CALL_RESULT",
        eventId: "history:tcr:tc1",
        toolCallId: "tc1",
        result: '"ok"',
      },
    ]);
  });

  it("skips user-role events", () => {
    const out = historyEventsToRawAGUI([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", sourceMessageId: "m1" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("TEXT_MESSAGE_CONTENT");
  });

  it("handles a realistic multi-turn slice (current run only)", () => {
    // Slice of historyEvents starting AFTER the user message for the current run
    const out = historyEventsToRawAGUI([
      {
        role: "tool",
        toolCalls: [
          {
            id: "tooluse_X",
            function: { name: "reject_test_cases", arguments: '{"ids":["a"]}' },
          },
        ],
      },
      { role: "tool", toolCallId: "tooluse_X", content: '""' },
      {
        role: "assistant",
        content: "Done! Removed.",
        sourceMessageId: "msg-final",
      },
    ]);
    expect(out.map((e) => e.type)).toEqual([
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
      "TEXT_MESSAGE_CONTENT",
    ]);
  });
});
