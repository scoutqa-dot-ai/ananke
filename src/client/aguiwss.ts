import { Client as StompClient, IMessage } from "@stomp/stompjs";
import WebSocket from "ws";
import { z } from "zod";

import { convertToAGUIEvent } from "./events.js";
import { DEFAULT_CLIENT_TIMEOUT_MS } from "../constants.js";
import type { TimestampedEvent } from "./events.js";
import type { Logger } from "../logger.js";

// Assign WebSocket to globalThis for @stomp/stompjs
Object.assign(globalThis, { WebSocket });

export interface AGUIWSSClientOptions {
  endpoint: string;
  agentId: string;
  headers?: Record<string, string>;
  timeout_ms?: number;
  logger?: Logger;

  // AG-UI specific options
  forwardedProps?: Record<string, unknown>;
  state?: Record<string, unknown>;
  threadId?: string;

  // WebSocket/STOMP options
  wsUrl: string;
  wsTopic: string;
  wsHeaders?: Record<string, string>;
  wsStompHeaders?: Record<string, string>;
}


const eventSchema = z.object({
  type: z.string(),
  delta: z.string().optional(),
  toolCallName: z.string().optional(),
  toolCallId: z.string().optional(),
  content: z.string().optional(),
  error: z.string().optional(),
  runId: z.string().optional(),
  threadId: z.string().optional(),
  messageId: z.string().optional(),
  parentMessageId: z.string().optional(),
  role: z.string().optional(),
  result: z.unknown().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
});

const payloadSchema = z.object({
  events: z.array(z.unknown()).optional(),
  conversationId: z.string().optional(),
});

const messageSchema = z.object({
  additionalData: payloadSchema.optional(),
});

const SENSITIVE_HEADER_RE = /^(Authorization|Cookie|X-Api-Key|Token):.*$/gim;
const STOMP_NOISE_RE = /^>>>?\s*PING$|^<<<?\s*PONG$|ping\s*every\s*\d+ms|pong\s*every\s*\d+ms|using\s*runInterval|outgoing\s*ping\s*disposeInterval|Web Socket Opened|Received data|connected to server/i;

function isStompNoise(msg: string): boolean {
  return STOMP_NOISE_RE.test(msg.trim());
}

function sanitizeStompDebug(msg: string): string {
  // Redact sensitive headers
  const redacted = msg.replace(SENSITIVE_HEADER_RE, (match) => {
    const colon = match.indexOf(":");
    return `${match.slice(0, colon)}:[REDACTED]`;
  });
  // Collapse to single line and truncate (STOMP dumps full frame bodies)
  const escaped = redacted.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  if (escaped.length > 80) {
    return `${escaped.slice(0, 80)}... (${msg.length} chars)`;
  }
  return escaped;
}

/**
 * AG-UI client that receives events via STOMP/WebSocket
 * and sends messages via HTTP POST.
 *
 * Based on the ag-ui-wss CLI protocol:
 * - Events arrive via STOMP subscription as accumulated arrays
 * - Each WS message contains ALL events so far (deduplication needed)
 * - Messages are sent via HTTP POST to {endpoint}/{agentId}/run
 */
export class AGUIWSSClient {
  private endpoint: string;
  private agentId: string;
  private timeout_ms: number;
  private headers: Record<string, string>;
  private logger?: Logger;
  private state: Record<string, unknown> | undefined;
  private threadId: string;
  private forwardedProps: Record<string, unknown> | undefined;
  private wsUrl: string;
  private wsTopic: string;
  private wsHeaders: Record<string, string>;
  private wsStompHeaders: Record<string, string>;
  private stompClient: StompClient | undefined;

  constructor(options: AGUIWSSClientOptions) {
    this.endpoint = options.endpoint;
    this.agentId = options.agentId;
    this.timeout_ms = options.timeout_ms ?? DEFAULT_CLIENT_TIMEOUT_MS;
    this.headers = options.headers ?? {};
    this.logger = options.logger;
    this.state = options.state;
    this.threadId = options.threadId ?? crypto.randomUUID();
    this.forwardedProps = options.forwardedProps;
    this.wsUrl = options.wsUrl;
    this.wsTopic = options.wsTopic;
    this.wsHeaders = options.wsHeaders ?? {};
    this.wsStompHeaders = options.wsStompHeaders ?? {};
  }

  async *sendMessage(options: {
    message: string;
  }): AsyncGenerator<TimestampedEvent> {
    let processedEventCount = 0;
    const eventQueue: TimestampedEvent[] = [];
    let done = false;
    let error: Error | undefined;
    let resolveWaiting: (() => void) | undefined;
    let activeTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const scheduleTimeout = () => {
      if (activeTimeoutId) clearTimeout(activeTimeoutId);
      if (done) return;
      activeTimeoutId = setTimeout(() => {
        error = new Error(
          `No events for ${this.timeout_ms / 1000}s, idle timeout`
        );
        done = true;
        resolveWaiting?.();
      }, this.timeout_ms);
    };

    const onPayload = (payload: z.infer<typeof payloadSchema>) => {
      if (payload.conversationId && payload.conversationId !== this.threadId) {
        this.logger?.trace(`[AGUIWSS] Skipping payload for different conversation: ${payload.conversationId} (expected: ${this.threadId})`);
        return;
      }

      const events = payload.events;
      if (!events || events.length === 0) return;

      scheduleTimeout();

      const newEvents = events.slice(processedEventCount);
      processedEventCount = events.length;

      for (const raw of newEvents) {
        const parsed = eventSchema.safeParse(raw);
        if (!parsed.success) continue;
        const event = parsed.data;

        const aguiEvent = convertToAGUIEvent(event);
        if (aguiEvent) {
          eventQueue.push({ ...aguiEvent, _ts: Date.now() });

          if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
            done = true;
          }
        }
      }

      resolveWaiting?.();
    };

    // Connect STOMP and subscribe
    const stompClient = await this.connectStomp(onPayload);
    this.stompClient = stompClient;

    // Start idle timeout
    scheduleTimeout();

    // Send HTTP message
    try {
      this.logger?.trace(`[AGUIWSS] Sending message to ${this.endpoint}/${this.agentId}/run`);
      await this.sendHttpMessage(options.message);
    } catch (err) {
      if (activeTimeoutId) clearTimeout(activeTimeoutId);
      await this.cleanup();
      const msg = err instanceof Error ? err.message : "Unknown error";
      yield {
        type: "RUN_ERROR",
        runId: "",
        message: msg,
        _ts: Date.now(),
      };
      return;
    }

    // Yield events as they arrive
    try {
      while (!done || eventQueue.length > 0) {
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        } else if (!done) {
          await new Promise<void>((resolve) => {
            resolveWaiting = resolve;
          });
        }
      }
    } finally {
      if (activeTimeoutId) clearTimeout(activeTimeoutId);
      await this.cleanup();
    }

    if (error) {
      yield {
        type: "RUN_ERROR",
        runId: "",
        message: error.message,
        _ts: Date.now(),
      };
    }
  }

  async close(): Promise<void> {
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.stompClient?.connected) {
      await this.stompClient.deactivate();
      this.stompClient = undefined;
    }
  }

  private connectStomp(
    onEvent: (payload: z.infer<typeof payloadSchema>) => void
  ): Promise<StompClient> {
    return new Promise((resolve, reject) => {
      const client = new StompClient({
        webSocketFactory: () => {
          const hasWsHeaders = Object.keys(this.wsHeaders).length > 0;
          return new WebSocket(
            this.wsUrl,
            hasWsHeaders ? { headers: this.wsHeaders } : undefined
          ) as unknown as globalThis.WebSocket;
        },
        connectHeaders: this.wsStompHeaders,
        reconnectDelay: 0,
        debug: (msg) => {
          if (!isStompNoise(msg)) {
            this.logger?.trace(`[STOMP] ${sanitizeStompDebug(msg)}`);
          }
        },
      });

      client.onConnect = () => {
        this.logger?.trace(`[AGUIWSS] STOMP connected, subscribing to ${this.wsTopic}`);
        client.subscribe(
          this.wsTopic,
          (message: IMessage) => {
            const parsed = messageSchema.safeParse(JSON.parse(message.body));
            if (parsed.success && parsed.data.additionalData) {
              onEvent(parsed.data.additionalData);
            }
          },
          this.wsStompHeaders
        );
        resolve(client);
      };

      client.onStompError = (frame) => {
        reject(
          new Error(`STOMP error: ${frame.headers.message ?? "unknown"}`)
        );
      };

      client.onWebSocketError = (event) => {
        const detail =
          event instanceof Error
            ? event.message
            : typeof event === "object" && event !== null && "message" in event
              ? String((event as { message: unknown }).message)
              : JSON.stringify(event);
        reject(new Error(`WebSocket error: ${detail}`));
      };

      client.activate();
    });
  }

  private async sendHttpMessage(message: string): Promise<void> {
    const url = `${this.endpoint}/${this.agentId}/run`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...this.headers,
      },
      body: JSON.stringify({
        threadId: this.threadId,
        runId: crypto.randomUUID(),
        messages: [
          { id: Date.now().toString(), role: "user", content: message },
        ],
        tools: [],
        context: [],
        forwardedProps: this.forwardedProps ?? {},
        state: this.state ?? {},
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
  }
}

