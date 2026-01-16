import type { ProtocolClient } from "../client/types.js";
import type { AGUIEvent } from "../client/events.js";
import type { TurnData, ToolCall } from "../types/index.js";

interface PendingToolCall {
  name: string;
  argsBuffer: string;
  startTs: number;
}

/**
 * Execute a user message turn and collect data
 */
export async function executeTurn(
  client: ProtocolClient,
  userMessage: string,
  turnIndex: number
): Promise<TurnData> {
  const events = client.sendMessage({ message: userMessage });
  return collectTurnData(events, turnIndex);
}

/**
 * Execute a connect turn (no message, just observe) and collect data
 */
export async function executeConnectTurn(
  client: ProtocolClient,
  turnIndex: number
): Promise<TurnData> {
  if (!client.connect) {
    throw new Error("Client does not support connect operation");
  }
  const events = client.connect();
  return collectTurnData(events, turnIndex);
}

/**
 * Collect turn data from an event stream
 */
export async function collectTurnData(
  events: AsyncGenerator<AGUIEvent>,
  turnIndex: number
): Promise<TurnData> {
  const startTs = Date.now();
  const toolCalls: ToolCall[] = [];
  const pendingToolCalls = new Map<string, PendingToolCall>();
  let assistantText = '';

  for await (const event of events) {
    handleEvent(event, toolCalls, pendingToolCalls, (text) => {
      assistantText += text;
    });
  }

  const endTs = Date.now();

  return {
    turnIndex,
    toolCalls,
    assistantText,
    startTs,
    endTs,
  };
}

function handleEvent(
  event: AGUIEvent,
  toolCalls: ToolCall[],
  pendingToolCalls: Map<string, PendingToolCall>,
  onText: (text: string) => void
): void {
  switch (event.type) {
    case 'TEXT_MESSAGE_CONTENT':
      onText(event.delta);
      break;

    case 'TOOL_CALL_START':
      pendingToolCalls.set(event.toolCallId, {
        name: event.toolCallName,
        argsBuffer: '',
        startTs: Date.now(),
      });
      break;

    case 'TOOL_CALL_ARGS': {
      const pending = pendingToolCalls.get(event.toolCallId);
      if (pending) {
        pending.argsBuffer += event.delta;
      }
      break;
    }

    case 'TOOL_CALL_RESULT': {
      const pending = pendingToolCalls.get(event.toolCallId);
      if (pending) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(pending.argsBuffer || '{}');
        } catch {
          // Keep empty args if parsing fails
        }

        let result: unknown = event.result;
        try {
          result = JSON.parse(event.result);
        } catch {
          // Keep as string if not valid JSON
        }

        toolCalls.push({
          name: pending.name,
          args,
          result,
          timestamp: Date.now(),
        });

        pendingToolCalls.delete(event.toolCallId);
      }
      break;
    }

    case 'RUN_ERROR':
      throw new Error(`AG-UI run error: ${event.message}`);
  }
}
