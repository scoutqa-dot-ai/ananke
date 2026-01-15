import type { AGUIClient } from '../client/index.js';
import type { AGUIEvent } from '../client/events.js';
import type { TurnData, ToolCall } from '../types/index.js';

interface PendingToolCall {
  name: string;
  argsBuffer: string;
  startTs: number;
}

/**
 * Execute a single turn and collect data
 */
export async function executeTurn(
  client: AGUIClient,
  userMessage: string,
  turnIndex: number,
  threadId?: string
): Promise<{ turnData: TurnData; threadId?: string }> {
  const startTs = Date.now();
  const toolCalls: ToolCall[] = [];
  const pendingToolCalls = new Map<string, PendingToolCall>();
  let assistantText = '';
  let currentThreadId = threadId;

  const events = client.sendMessage({
    threadId,
    message: userMessage,
  });

  for await (const event of events) {
    currentThreadId = handleEvent(
      event,
      toolCalls,
      pendingToolCalls,
      (text) => {
        assistantText += text;
      },
      currentThreadId
    );
  }

  const endTs = Date.now();

  return {
    turnData: {
      turnIndex,
      toolCalls,
      assistantText,
      startTs,
      endTs,
    },
    threadId: currentThreadId,
  };
}

function handleEvent(
  event: AGUIEvent,
  toolCalls: ToolCall[],
  pendingToolCalls: Map<string, PendingToolCall>,
  onText: (text: string) => void,
  threadId?: string
): string | undefined {
  switch (event.type) {
    case 'RUN_STARTED':
      return event.threadId ?? threadId;

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

  return threadId;
}
