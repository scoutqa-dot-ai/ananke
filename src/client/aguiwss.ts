import { Client as StompClient, IMessage } from "@stomp/stompjs";
import WebSocket from "ws";
import { z } from "zod";

import { toProtocolEvent } from "./events.js";
import { DEFAULT_CLIENT_TIMEOUT_MS, DEFAULT_POLL_IDLE_THRESHOLD_MS, DEFAULT_POLL_INTERVAL_MS } from "../constants.js";
import type { TimestampedProtocolEvent, TimestampedEvent } from "./events.js";
import type { Logger } from "../logger.js";
import { truncateLine } from "../runner/format.js";

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

  // Polling fallback options
  /** Idle threshold (ms) before polling fallback kicks in. Default: 60_000 */
  pollIdleThreshold_ms?: number;
  /** Polling interval (ms) once fallback is active. Default: 5_000 */
  pollInterval_ms?: number;
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

// The /connect endpoint returns a conversation snapshot in this shape when the
// run is paused or finished server-side but WSS never emitted a terminator.
const historyToolCallSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string().optional(),
  }),
});
const historyEventSchema = z.object({
  id: z.string().optional(),
  sourceMessageId: z.string().optional(),
  role: z.string().optional(),
  content: z.string().optional(),
  toolCalls: z.array(historyToolCallSchema).optional(),
  toolCallId: z.string().optional(),
});
const connectResponseSchema = z.object({
  status: z.string().optional(),
  historyEvents: z.array(historyEventSchema).optional(),
  events: z.array(z.unknown()).optional(),
  conversationId: z.string().optional(),
});

// Statuses returned by /connect that mean "this run is done from the server's
// POV, stop waiting for more events."
const TERMINAL_CONNECT_STATUSES = new Set([
  "input-required",
  "completed",
  "succeeded",
  "failed",
  "errored",
  "canceled",
  "cancelled",
]);
const FAILED_CONNECT_STATUSES = new Set(["failed", "errored"]);

/**
 * Find the index of the first historyEvent that belongs to the current run.
 * Strategy: locate the most-recent user message matching the text we sent;
 * everything after it is the agent's response to this run.
 *
 * Falls back to 0 if no match (treats all history as current — only used as a
 * last resort; will be filtered by per-message dedup downstream).
 */
export function findRunStartIndex(
  history: z.infer<typeof historyEventSchema>[],
  userMessage: string | null,
): number {
  if (userMessage === null) return history.length; // resume(): no user text → recover nothing by content match
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user" && history[i].content === userMessage) {
      return i + 1;
    }
  }
  return history.length; // No match — safer to recover nothing than to leak prior turns
}

export function historyEventsToRawAGUI(
  history: z.infer<typeof historyEventSchema>[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const ev of history) {
    if (ev.role === "assistant" && ev.content && ev.sourceMessageId) {
      out.push({
        type: "TEXT_MESSAGE_CONTENT",
        eventId: `history:msg:${ev.sourceMessageId}`,
        messageId: ev.sourceMessageId,
        delta: ev.content,
      });
      continue;
    }
    if (ev.role === "tool" && ev.toolCalls?.length) {
      for (const tc of ev.toolCalls) {
        out.push({
          type: "TOOL_CALL_START",
          eventId: `history:tcs:${tc.id}`,
          toolCallId: tc.id,
          toolCallName: tc.function.name,
        });
        if (tc.function.arguments) {
          out.push({
            type: "TOOL_CALL_ARGS",
            eventId: `history:tca:${tc.id}`,
            toolCallId: tc.id,
            delta: tc.function.arguments,
          });
        }
        out.push({
          type: "TOOL_CALL_END",
          eventId: `history:tce:${tc.id}`,
          toolCallId: tc.id,
        });
      }
      continue;
    }
    if (ev.role === "tool" && ev.toolCallId && typeof ev.content === "string") {
      out.push({
        type: "TOOL_CALL_RESULT",
        eventId: `history:tcr:${ev.toolCallId}`,
        toolCallId: ev.toolCallId,
        result: ev.content,
      });
    }
  }
  return out;
}

const SENSITIVE_HEADER_RE = /^(Authorization|Cookie|X-Api-Key|Token):.*$/gim;
const STOMP_NOISE_RE = /^>>>?\s*PING$|^<<<?\s*PONG$|ping\s*every\s*\d+ms|pong\s*every\s*\d+ms|using\s*runInterval|outgoing\s*ping\s*disposeInterval|Web Socket Opened|Received data|connected to server/i;

function isStompNoise(msg: string): boolean {
  return STOMP_NOISE_RE.test(msg.trim());
}

function sanitizeStompDebug(msg: string): string {
  // Redact sensitive headers then collapse + truncate
  const redacted = msg.replace(SENSITIVE_HEADER_RE, (match) => {
    const colon = match.indexOf(":");
    return `${match.slice(0, colon)}:[REDACTED]`;
  });
  return truncateLine(redacted);
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
  private pollIdleThreshold_ms: number;
  private pollInterval_ms: number;

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
    this.pollIdleThreshold_ms = options.pollIdleThreshold_ms ?? DEFAULT_POLL_IDLE_THRESHOLD_MS;
    this.pollInterval_ms = options.pollInterval_ms ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async *message(text: string): AsyncGenerator<TimestampedEvent> {
    const seenEventIds = new Set<string>();
    const seenTextLengths = new Map<string, number>();
    // Dedup TOOL_CALL_* by `${toolCallId}:${kind}` — WSS and recovered history
    // payloads use different eventIds for the same tool call.
    const seenToolCallEventKeys = new Set<string>();
    const eventQueue: TimestampedProtocolEvent[] = [];
    let done = false;
    let error: Error | undefined;
    let resolveWaiting: (() => void) | undefined;
    let activeTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let transportFrameCount = 0;
    let transportBytesReceived = 0;
    let lastEventTime = Date.now();
    let pollTimerId: ReturnType<typeof setInterval> | undefined;
    let polling = false;
    let aguiwssPollActivations = 0;
    let aguiwssPollRequests = 0;
    let aguiwssPollRecoveredEvents = 0;

    const startPolling = () => {
      if (polling || done) return;
      polling = true;
      aguiwssPollActivations++;
      this.logger?.debug(`[AGUIWSS] WSS idle for ${this.pollIdleThreshold_ms / 1000}s, starting HTTP poll fallback every ${this.pollInterval_ms / 1000}s`);
      const trackRequest = () => { aguiwssPollRequests++; };
      pollTimerId = setInterval(() => {
        if (done) { stopPolling(); return; }
        this.pollConnect(onPayloadFromPoll, trackRequest, text);
      }, this.pollInterval_ms);
      // Fire one immediately
      this.pollConnect(onPayloadFromPoll, trackRequest, text);
    };

    const stopPolling = () => {
      if (!polling) return;
      polling = false;
      if (pollTimerId) { clearInterval(pollTimerId); pollTimerId = undefined; }
      this.logger?.debug(`[AGUIWSS] Events resumed via WSS, stopping HTTP poll fallback`);
    };

    const scheduleTimeout = () => {
      if (activeTimeoutId) clearTimeout(activeTimeoutId);
      if (done) return;
      activeTimeoutId = setTimeout(() => {
        error = new Error(
          `No events for ${this.timeout_ms / 1000}s, idle timeout`
        );
        done = true;
        stopPolling();
        resolveWaiting?.();
      }, this.timeout_ms);
    };

    const onPayload = (payload: z.infer<typeof payloadSchema>, source: "wss" | "poll") => {
      if (payload.conversationId && payload.conversationId !== this.threadId) {
        this.logger?.trace(`[AGUIWSS] Skipping payload for different conversation: ${payload.conversationId} (expected: ${this.threadId})`);
        return;
      }

      const events = payload.events;
      if (!events || events.length === 0) return;

      const queueLenBefore = eventQueue.length;
      lastEventTime = Date.now();
      if (source === "wss" && polling) stopPolling();
      scheduleTimeout();

      // Deduplicate using event IDs — the server sends the full accumulated
      // event list each time, and may replace/rewrite earlier entries, so we
      // cannot rely on array position for dedup.
      //
      // For TEXT_MESSAGE_CONTENT the server re-sends the same event ID with a
      // growing `delta` that contains the full text so far.  We convert that
      // into an incremental delta so downstream consumers (collectStepData)
      // can simply append.
      for (const raw of events) {
        const obj = raw as Record<string, unknown>;
        const eventId = String(obj.eventId ?? obj.id ?? "");
        const eventType = String(obj.type ?? "");

        // For TEXT_MESSAGE_CONTENT: compute incremental delta from cumulative.
        // The server re-sends the same message with a growing delta but
        // assigns a new eventId each time, so we track by messageId instead.
        if (eventType === "TEXT_MESSAGE_CONTENT") {
          const textKey = String(obj.messageId ?? "") || "TEXT_MESSAGE_CONTENT";
          const fullDelta = String(obj.delta ?? "");
          const prevLen = seenTextLengths.get(textKey) ?? 0;
          seenTextLengths.set(textKey, fullDelta.length);
          if (eventId) seenEventIds.add(eventId);

          if (fullDelta.length <= prevLen) continue; // No new text

          const incrementalDelta = fullDelta.slice(prevLen);
          const aguiEvent: TimestampedProtocolEvent = {
            type: "TEXT_MESSAGE_CONTENT",
            messageId: String(obj.messageId ?? ""),
            delta: incrementalDelta,
            "ananke:ts": Date.now(),
          };
          eventQueue.push(aguiEvent);
          continue;
        }

        // TOOL_CALL_* dedup by toolCallId+kind — same tool call can arrive via
        // both WSS and recovered history with different eventIds.
        if (eventType.startsWith("TOOL_CALL_")) {
          const tcId = String(obj.toolCallId ?? "");
          if (tcId) {
            const kind = eventType.slice("TOOL_CALL_".length).toLowerCase();
            const key = `${tcId}:${kind}`;
            if (seenToolCallEventKeys.has(key)) continue;
            seenToolCallEventKeys.add(key);
          }
        }

        // Skip events we've already processed (by ID)
        if (eventId && seenEventIds.has(eventId)) continue;
        if (eventId) seenEventIds.add(eventId);

        const parsed = eventSchema.safeParse(raw);
        if (!parsed.success) {
          this.logger?.debug(`[AGUIWSS] Event failed schema parse: ${parsed.error.message}`);
          this.logger?.trace(`[AGUIWSS] Raw event: ${JSON.stringify(raw).slice(0, 500)}`);
          continue;
        }
        const event = parsed.data;

        const aguiEvent = toProtocolEvent(event);
        if (aguiEvent) {
          eventQueue.push({ ...aguiEvent, "ananke:ts": Date.now() });

          if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
            done = true;
          }
        } else {
          this.logger?.trace(`[AGUIWSS] Event type "${event.type}" not mapped to protocol event, skipped`);
        }
      }
      if (source === "poll") {
        const newEvents = eventQueue.length - queueLenBefore;
        if (newEvents > 0) {
          aguiwssPollRecoveredEvents += newEvents;
          this.logger?.debug(`[AGUIWSS] Poll recovered ${newEvents} new event(s)`);
        }
      }
      resolveWaiting?.();
    };

    const onPayloadFromWss = (payload: z.infer<typeof payloadSchema>) => onPayload(payload, "wss");
    const onPayloadFromPoll = (payload: z.infer<typeof payloadSchema>) => onPayload(payload, "poll");

    // Connect STOMP and subscribe
    const stompClient = await this.connectStomp(onPayloadFromWss, (byteLength) => {
      transportFrameCount++;
      transportBytesReceived += byteLength;
    });
    this.stompClient = stompClient;

    // Start idle timeout
    scheduleTimeout();

    // Periodically check if WSS has gone idle and activate polling fallback
    const idleCheckId = setInterval(() => {
      if (done) { clearInterval(idleCheckId); return; }
      const idleMs = Date.now() - lastEventTime;
      if (idleMs >= this.pollIdleThreshold_ms && !polling) {
        startPolling();
      }
    }, this.pollIdleThreshold_ms);

    // Send HTTP message
    try {
      this.logger?.trace(`[AGUIWSS] Sending message to ${this.endpoint}/${this.agentId}/run`);
      await this.sendHttpMessage(text);
    } catch (err) {
      if (activeTimeoutId) clearTimeout(activeTimeoutId);
      clearInterval(idleCheckId);
      stopPolling();
      await this.cleanup();
      const msg = err instanceof Error ? err.message : "Unknown error";
      yield {
        type: "ananke:transport_stats" as const,
        transportFrameCount,
        transportBytesReceived,
        aguiwssPollActivations,
        aguiwssPollRequests,
        aguiwssPollRecoveredEvents,
        "ananke:ts": Date.now(),
      };
      yield {
        type: "RUN_ERROR",
        runId: "",
        message: msg,
        "ananke:ts": Date.now(),
      };
      return;
    }

    let statsEmitted = false;
    const buildStats = (): TimestampedEvent => ({
      type: "ananke:transport_stats" as const,
      transportFrameCount,
      transportBytesReceived,
      aguiwssPollActivations,
      aguiwssPollRequests,
      aguiwssPollRecoveredEvents,
      "ananke:ts": Date.now(),
    });

    // Yield events as they arrive. Emit transport_stats immediately before any
    // terminal event (RUN_FINISHED or server-originated RUN_ERROR) so consumers
    // that abort on RUN_ERROR still receive the stats.
    try {
      while (!done || eventQueue.length > 0) {
        if (eventQueue.length > 0) {
          const next = eventQueue.shift()!;
          if (!statsEmitted && (next.type === "RUN_ERROR" || next.type === "RUN_FINISHED")) {
            statsEmitted = true;
            yield buildStats();
          }
          yield next;
        } else if (!done) {
          await new Promise<void>((resolve) => {
            resolveWaiting = resolve;
          });
        }
      }
    } finally {
      if (activeTimeoutId) clearTimeout(activeTimeoutId);
      clearInterval(idleCheckId);
      stopPolling();
      await this.cleanup();
    }

    // Fallback path: idle-timeout (no terminal event was queued). Emit stats
    // before the synthesized RUN_ERROR.
    if (!statsEmitted) {
      statsEmitted = true;
      yield buildStats();
    }

    if (error) {
      yield {
        type: "RUN_ERROR",
        runId: "",
        message: error.message,
        "ananke:ts": Date.now(),
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
    onEvent: (payload: z.infer<typeof payloadSchema>) => void,
    onFrame?: (byteLength: number) => void,
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
            onFrame?.(message.binaryBody?.byteLength ?? Buffer.byteLength(message.body, "utf-8"));
            let body: unknown;
            try {
              body = JSON.parse(message.body);
            } catch (err) {
              this.logger?.debug(`[AGUIWSS] Failed to parse message body as JSON: ${err instanceof Error ? err.message : err}`);
              return;
            }
            const parsed = messageSchema.safeParse(body);
            if (!parsed.success) {
              this.logger?.debug(`[AGUIWSS] Message failed schema validation: ${parsed.error.message}`);
              return;
            }
            if (parsed.data.additionalData) {
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

  private async pollConnect(
    onPayload: (payload: z.infer<typeof payloadSchema>) => void,
    onRequest?: () => void,
    userMessage: string | null = null,
  ): Promise<void> {
    const url = `${this.endpoint}/${this.agentId}/connect`;
    try {
      onRequest?.();
      this.logger?.trace(`[AGUIWSS] Poll fallback POST ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...this.headers,
        },
        body: JSON.stringify({ threadId: this.threadId }),
      });
      if (!response.ok) {
        this.logger?.debug(`[AGUIWSS] Poll fallback HTTP ${response.status}`);
        return;
      }
      const body: unknown = await response.json();
      // The response may be a payload directly, wrapped in a message envelope,
      // or a /connect snapshot { status, historyEvents } that we translate
      // back into AG-UI events.
      const asMessage = messageSchema.safeParse(body);
      if (asMessage.success && asMessage.data.additionalData?.events?.length) {
        onPayload(asMessage.data.additionalData);
        return;
      }
      const asConnect = connectResponseSchema.safeParse(body);
      if (!asConnect.success) return;

      const recovered: Record<string, unknown>[] = [];
      if (asConnect.data.events?.length) {
        recovered.push(...(asConnect.data.events as Record<string, unknown>[]));
      }
      if (asConnect.data.historyEvents?.length) {
        const startIdx = findRunStartIndex(asConnect.data.historyEvents, userMessage);
        if (startIdx < asConnect.data.historyEvents.length) {
          recovered.push(
            ...historyEventsToRawAGUI(asConnect.data.historyEvents.slice(startIdx)),
          );
        }
      }
      const status = asConnect.data.status;
      if (status && TERMINAL_CONNECT_STATUSES.has(status)) {
        const isError = FAILED_CONNECT_STATUSES.has(status);
        recovered.push(
          isError
            ? {
                type: "RUN_ERROR",
                eventId: "ananke:run_error:synthesized",
                runId: this.threadId,
                message: `Run ${status}`,
              }
            : {
                type: "RUN_FINISHED",
                eventId: "ananke:run_finished:synthesized",
                runId: this.threadId,
              },
        );
        this.logger?.debug(`[AGUIWSS] Poll detected terminal status "${status}", synthesizing terminator`);
      }
      if (recovered.length > 0) {
        onPayload({ events: recovered, conversationId: asConnect.data.conversationId });
      }
    } catch (err) {
      this.logger?.debug(`[AGUIWSS] Poll fallback error: ${err instanceof Error ? err.message : err}`);
    }
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

