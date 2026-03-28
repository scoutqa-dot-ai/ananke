import {
  randomUUID,
  RunAgentInput,
  runHttpRequest,
  transformHttpEventStream,
} from "@ag-ui/client";
import { toProtocolEvent } from "./events.js";
import { DEFAULT_CLIENT_TIMEOUT_MS, DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_MS } from "../constants.js";
import type { TimestampedProtocolEvent } from "./events.js";
import type { Logger } from "../logger.js";

export interface AGUIClientOptions {
  endpoint: string;
  headers?: Record<string, string>;
  maxRetries?: number;
  timeout_ms?: number;
  logger?: Logger;

  // AG-UI specific options
  agentId?: string;
  forwardedProps?: Record<string, unknown>;
  state?: Record<string, unknown>;
  threadId?: string;
}


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
  private timeout_ms: number;
  private headers: Record<string, string>;
  private logger?: Logger;
  private state: Record<string, unknown> | undefined;
  private threadId: string;
  private forwardedProps: Record<string, unknown> | undefined;

  constructor(options: AGUIClientOptions) {
    this.endpoint = options.endpoint;
    this.agentId = options.agentId ?? "";
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeout_ms = options.timeout_ms ?? DEFAULT_CLIENT_TIMEOUT_MS;
    this.headers = options.headers ?? {};
    this.logger = options.logger;
    this.state = options.state;
    this.threadId = options.threadId ?? randomUUID();
    this.forwardedProps = options.forwardedProps;

    if (this.agentId.length === 0) {
      throw new Error("AGUIClient requires an agentId");
    }
  }

  /**
   * Send a message and stream events via SSE (agent/run)
   */
  async *message(text: string): AsyncGenerator<TimestampedProtocolEvent> {
    const input: RunAgentInput = {
      context: [],
      forwardedProps: this.forwardedProps,
      runId: randomUUID(),
      state: this.state,
      threadId: this.threadId,
      tools: [],
      messages: [{ id: randomUUID(), role: "user", content: text }],
    };

    yield* this.executeRequest("agent/run", input);
  }

  /**
   * Resume an existing thread without sending a message (agent/connect)
   */
  async *resume(): AsyncGenerator<TimestampedProtocolEvent> {
    const input: RunAgentInput = {
      context: [],
      forwardedProps: this.forwardedProps,
      messages: [],
      runId: randomUUID(),
      state: this.state,
      threadId: this.threadId,
      tools: [],
    };

    yield* this.executeRequest("agent/connect", input);
  }

  /**
   * Execute a request to the AG-UI endpoint
   */
  private async *executeRequest(
    method: string,
    input: RunAgentInput
  ): AsyncGenerator<TimestampedProtocolEvent> {
    const events: TimestampedProtocolEvent[] = [];
    let receivedMeaningfulEvents = false;

    const executeStream = async (attempt: number): Promise<void> => {
      // Reset state for this attempt
      events.length = 0;
      receivedMeaningfulEvents = false;

      // Wrap in CopilotKit envelope format
      const envelope = {
        method,
        params: { agentId: this.agentId },
        body: input,
      };

      // Set up timeout using AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, this.timeout_ms);

      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...this.headers,
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      };

      this.logger?.trace(`[AG-UI] ${method} -> ${this.endpoint} (timeout: ${this.timeout_ms}ms)`);
      this.logger?.trace(`[AG-UI] Request: ${JSON.stringify(envelope, null, 2)}`);

      try {
        const httpEvents = runHttpRequest(this.endpoint, requestInit);
        const eventStream = transformHttpEventStream(httpEvents);

        // Convert Observable to Promise and collect events
        await new Promise<void>((resolve, reject) => {
          eventStream.subscribe({
            next: (event) => {
              receivedMeaningfulEvents = true;
              this.logger?.trace(`[AG-UI] Event: ${event.type}`);
              const aguiEvent = toProtocolEvent(event);
              if (aguiEvent) {
                // Add timestamp at event arrival time
                events.push({ ...aguiEvent, "ananke:ts": Date.now() });
              }
            },
            error: (err) => {
              clearTimeout(timeoutId);
              const isTimeout = err instanceof Error && err.name === "AbortError";
              const message = isTimeout
                ? `Request timed out after ${this.timeout_ms}ms`
                : err instanceof Error
                  ? err.message
                  : "Unknown error";
              this.logger?.trace(`[AG-UI] Error: ${message}`);
              events.push({
                type: "RUN_ERROR",
                runId: "",
                message,
                "ananke:ts": Date.now(),
              });
              reject(err);
            },
            complete: () => {
              clearTimeout(timeoutId);
              this.logger?.trace(`[AG-UI] Stream complete (${events.length} events)`);
              resolve();
            },
          });
        });

        // If completed without receiving any meaningful events, retry
        if (!receivedMeaningfulEvents && attempt < this.maxRetries) {
          this.logger?.trace(
            `[AG-UI] No events received, retrying (${attempt}/${this.maxRetries})...`
          );
          await sleep(DEFAULT_RETRY_DELAY_MS);
          return executeStream(attempt + 1);
        }
      } catch (error) {
        // Error already handled in subscribe.error
        if (
          events.length === 0 ||
          events[events.length - 1].type !== "RUN_ERROR"
        ) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          events.push({
            type: "RUN_ERROR",
            runId: "",
            message: msg,
            "ananke:ts": Date.now(),
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
