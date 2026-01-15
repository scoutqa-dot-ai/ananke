import {
  randomUUID,
  runHttpRequest,
  transformHttpEventStream,
} from '@ag-ui/client';
import type { AGUIEvent } from './events.js';

export interface AGUIClientOptions {
  endpoint: string;
  headers?: Record<string, string>;
  /** Agent ID for CopilotKit transport (default: "ag-ui-agent") */
  agentId?: string;
  /** Max retries when no events received */
  maxRetries?: number;
}

export interface SendMessageOptions {
  threadId?: string;
  message: string;
  /** Custom forwarded props for the request */
  forwardedProps?: Record<string, unknown>;
}

const DEFAULT_MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AG-UI client using the official @ag-ui/client library
 * Supports CopilotKit single-route transport format
 */
export class AGUIClient {
  private endpoint: string;
  private agentId: string;
  private maxRetries: number;
  private headers: Record<string, string>;

  constructor(options: AGUIClientOptions) {
    this.endpoint = options.endpoint;
    this.agentId = options.agentId ?? 'ag-ui-agent';
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.headers = options.headers ?? {};
  }

  /**
   * Send a message and stream events via SSE
   */
  async *sendMessage(options: SendMessageOptions): AsyncGenerator<AGUIEvent> {
    const events: AGUIEvent[] = [];
    let receivedMeaningfulEvents = false;

    const executeStream = async (attempt: number): Promise<void> => {
      // Reset state for this attempt
      events.length = 0;
      receivedMeaningfulEvents = false;

      // Build the request body
      const innerBody: Record<string, unknown> = {
        threadId: options.threadId,
        runId: randomUUID(),
        messages: options.message
          ? [{ id: randomUUID(), role: 'user', content: options.message }]
          : [],
      };

      if (options.forwardedProps) {
        innerBody.forwardedProps = options.forwardedProps;
      }

      // Wrap in CopilotKit envelope format
      const envelope = {
        method: 'agent/run',
        params: { agentId: this.agentId },
        body: innerBody,
      };

      const requestInit: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...this.headers,
        },
        body: JSON.stringify(envelope),
      };

      try {
        const httpEvents = runHttpRequest(this.endpoint, requestInit);
        const eventStream = transformHttpEventStream(httpEvents);

        // Convert Observable to Promise and collect events
        await new Promise<void>((resolve, reject) => {
          eventStream.subscribe({
            next: (event) => {
              receivedMeaningfulEvents = true;
              const aguiEvent = convertToAGUIEvent(event);
              if (aguiEvent) {
                events.push(aguiEvent);
              }
            },
            error: (err) => {
              events.push({
                type: 'RUN_ERROR',
                runId: '',
                message: err instanceof Error ? err.message : 'Unknown error',
              });
              reject(err);
            },
            complete: () => resolve(),
          });
        });

        // If completed without receiving any meaningful events, retry
        if (!receivedMeaningfulEvents && attempt < this.maxRetries) {
          await sleep(RETRY_DELAY_MS);
          return executeStream(attempt + 1);
        }
      } catch (error) {
        // Error already handled in subscribe.error
        if (events.length === 0 || events[events.length - 1].type !== 'RUN_ERROR') {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          events.push({
            type: 'RUN_ERROR',
            runId: '',
            message: msg,
          });
        }
      }
    };

    await executeStream(1);

    // Yield all collected events
    for (const event of events) {
      yield event;
    }
  }
}

/**
 * Convert BaseEvent from @ag-ui/client to our AGUIEvent type
 */
function convertToAGUIEvent(event: { type: string; [key: string]: unknown }): AGUIEvent | null {
  switch (event.type) {
    case 'RUN_STARTED':
      return {
        type: 'RUN_STARTED',
        runId: String(event.runId ?? ''),
        threadId: event.threadId as string | undefined,
      };

    case 'TEXT_MESSAGE_START':
      return {
        type: 'TEXT_MESSAGE_START',
        messageId: String(event.messageId ?? ''),
        role: 'assistant',
      };

    case 'TEXT_MESSAGE_CONTENT':
      return {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: String(event.messageId ?? ''),
        delta: String(event.delta ?? ''),
      };

    case 'TEXT_MESSAGE_END':
      return {
        type: 'TEXT_MESSAGE_END',
        messageId: String(event.messageId ?? ''),
      };

    case 'TOOL_CALL_START':
      return {
        type: 'TOOL_CALL_START',
        toolCallId: String(event.toolCallId ?? ''),
        toolCallName: String(event.toolCallName ?? ''),
        parentMessageId: event.parentMessageId as string | undefined,
      };

    case 'TOOL_CALL_ARGS':
      return {
        type: 'TOOL_CALL_ARGS',
        toolCallId: String(event.toolCallId ?? ''),
        delta: String(event.delta ?? ''),
      };

    case 'TOOL_CALL_END':
      return {
        type: 'TOOL_CALL_END',
        toolCallId: String(event.toolCallId ?? ''),
      };

    case 'TOOL_CALL_RESULT':
      return {
        type: 'TOOL_CALL_RESULT',
        toolCallId: String(event.toolCallId ?? ''),
        result: typeof event.result === 'string'
          ? event.result
          : JSON.stringify(event.result ?? ''),
      };

    case 'RUN_ERROR':
      return {
        type: 'RUN_ERROR',
        runId: String(event.runId ?? ''),
        message: String(event.message ?? 'Unknown error'),
        code: event.code as string | undefined,
      };

    case 'RUN_FINISHED':
      return {
        type: 'RUN_FINISHED',
        runId: String(event.runId ?? ''),
      };

    default:
      // Unknown event type, skip
      return null;
  }
}
