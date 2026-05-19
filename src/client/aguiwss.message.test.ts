/**
 * Behavioral tests for AGUIWSSClient.message() — drive the public API through
 * mocked transport (STOMP frames in, HTTP responses out) and assert on the
 * events the consumer observes.
 *
 * Only @stomp/stompjs and global fetch are mocked. Everything else (dedup
 * logic, recovery, terminator synthesis, metrics) runs as in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Fake STOMP client -----------------------------------------------------

interface FakeStompMessage {
  body: string;
  binaryBody?: Uint8Array;
}
type SubscriberCallback = (msg: FakeStompMessage) => void;

class FakeStompClient {
  static instances: FakeStompClient[] = [];
  onConnect: (() => void) | undefined;
  onStompError: ((frame: { headers: Record<string, string> }) => void) | undefined;
  onWebSocketError: ((event: unknown) => void) | undefined;
  connected = false;
  private subscriber: SubscriberCallback | undefined;

  constructor(_config: unknown) {
    FakeStompClient.instances.push(this);
  }

  activate(): void {
    // Real client calls onConnect asynchronously; mimic that.
    queueMicrotask(() => this.triggerConnect());
  }

  triggerConnect(): void {
    this.connected = true;
    this.onConnect?.();
  }

  triggerReconnect(): void {
    // Simulate a drop + reconnect: fire onConnect again.
    this.onConnect?.();
  }

  subscribe(_topic: string, callback: SubscriberCallback): { id: string } {
    this.subscriber = callback;
    return { id: "sub-1" };
  }

  async deactivate(): Promise<void> {
    this.connected = false;
  }

  // Deliver a STOMP frame body to the active subscriber.
  deliver(payload: unknown): void {
    if (!this.subscriber) throw new Error("No active subscriber");
    const body = JSON.stringify(payload);
    this.subscriber({ body });
  }
}

vi.mock("@stomp/stompjs", () => ({
  Client: FakeStompClient,
}));

// ---- Fake fetch ------------------------------------------------------------

type FetchHandler = (url: string, init?: RequestInit) => unknown;
let fetchRoutes: Map<string, FetchHandler>;

function setRoute(urlSuffix: string, handler: FetchHandler) {
  fetchRoutes.set(urlSuffix, handler);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---- Test harness ----------------------------------------------------------

// Import AFTER vi.mock so the mocked stompjs is used.
async function importClient() {
  const mod = await import("./aguiwss.js");
  return mod.AGUIWSSClient;
}

beforeEach(() => {
  FakeStompClient.instances = [];
  fetchRoutes = new Map();
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    for (const [suffix, handler] of fetchRoutes) {
      if (u.endsWith(suffix)) {
        const out = await handler(u, init);
        if (out instanceof Response) return out;
        return jsonResponse(out);
      }
    }
    return new Response("not mocked", { status: 500 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const THREAD = "thread-abc";
const CLIENT_OPTS = {
  endpoint: "http://test.local",
  agentId: "agent-1",
  wsUrl: "ws://test.local",
  wsTopic: "/topic/test",
  threadId: THREAD,
  timeout_ms: 5_000, // hard idle timeout
  pollIdleThreshold_ms: 100, // start polling fast
  pollInterval_ms: 50,
  stompReconnectDelay_ms: 50,
  stompHeartbeat_ms: 0,
  backgroundPollInterval_ms: 0,
};

/** Drain an async generator until done or until `stopWhen` returns true. */
async function drain<T>(
  gen: AsyncGenerator<T>,
  stopWhen?: (ev: T) => boolean,
  timeoutMs = 2_000,
): Promise<T[]> {
  const collected: T[] = [];
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (Date.now() > deadline) throw new Error("drain timeout");
    const { value, done } = await gen.next();
    if (done) break;
    collected.push(value);
    if (stopWhen?.(value)) break;
  }
  return collected;
}

/** Wait until at least one fake STOMP client is alive AND its subscriber is set. */
async function waitForSubscription(): Promise<FakeStompClient> {
  for (let i = 0; i < 100; i++) {
    const inst = FakeStompClient.instances[FakeStompClient.instances.length - 1];
    // `subscriber` is private; check via attempting deliver after we know
    // onConnect has fired (connected flips first, subscriber is set inside).
    // We wait an extra tick to give onConnect's body time to finish subscribing.
    if (inst?.connected) {
      await new Promise((r) => setTimeout(r, 5));
      return inst;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("STOMP never connected");
}

// ---- Tests -----------------------------------------------------------------

describe("AGUIWSSClient.message — end-to-end behaviors", () => {
  it("delivers a clean run via WSS only (RUN_STARTED → text → RUN_FINISHED)", async () => {
    setRoute("/agent-1/run", () => ({ ok: true }));
    const AGUIWSSClient = await importClient();
    const client = new AGUIWSSClient(CLIENT_OPTS);

    const gen = client.message("hello");
    const drainP = drain(gen); // start consuming concurrently — kicks the generator body
    const stomp = await waitForSubscription();

    stomp.deliver({
      additionalData: {
        conversationId: THREAD,
        seq: 1,
        events: [
          { type: "RUN_STARTED", runId: "r1", eventId: "e-start" },
          { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant", eventId: "e-tms" },
          { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hello world", eventId: "e-tmc1" },
        ],
      },
    });
    stomp.deliver({
      additionalData: {
        conversationId: THREAD,
        seq: 2,
        status: "completed",
        events: [
          { type: "TEXT_MESSAGE_END", messageId: "m1", eventId: "e-tme" },
          { type: "RUN_FINISHED", runId: "r1", eventId: "e-end" },
        ],
      },
    });

    const events = await drainP;
    const types = events.map((e) => e.type);
    expect(types).toContain("RUN_STARTED");
    expect(types).toContain("TEXT_MESSAGE_CONTENT");
    expect(types).toContain("RUN_FINISHED");
    expect(types[types.length - 1]).toBe("RUN_FINISHED");
    // transport_stats is emitted just before the terminator.
    expect(types[types.length - 2]).toBe("ananke:transport_stats");
    // The delta we observed equals the original text (no double-emission).
    const deltas = events
      .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
      .map((e) => (e as { delta: string }).delta)
      .join("");
    expect(deltas).toBe("hello world");
  });

  it("recovers terminator via /connect when WSS goes idle mid-text", async () => {
    setRoute("/agent-1/run", () => ({ ok: true }));
    setRoute("/agent-1/connect", () => ({
      status: "input-required",
      historyEvents: [
        { id: "h0", role: "user", content: "hello", sourceMessageId: "u1" },
        // Server has the FULL text — WSS only delivered "hello "
        {
          id: "h1",
          role: "assistant",
          content: "hello world",
          sourceMessageId: "m1",
        },
      ],
    }));

    const AGUIWSSClient = await importClient();
    const client = new AGUIWSSClient(CLIENT_OPTS);
    const gen = client.message("hello");
    const drainP = drain(gen);
    const stomp = await waitForSubscription();

    // WSS partial: only delivers "hello " then goes silent.
    stomp.deliver({
      additionalData: {
        conversationId: THREAD,
        seq: 1,
        events: [
          { type: "RUN_STARTED", runId: "r1", eventId: "e-start" },
          { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant", eventId: "e-tms" },
          { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hello ", eventId: "e-tmc1" },
        ],
      },
    });

    // Drain — polling activates after 100ms idle, /connect synthesizes terminator.
    const events = await drainP;
    const types = events.map((e) => e.type);
    expect(types[types.length - 1]).toBe("RUN_FINISHED");

    // The recovered delta should be "world" (gap-fill from cumulative "hello world").
    const deltas = events
      .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
      .map((e) => (e as { delta: string }).delta);
    expect(deltas.join("")).toBe("hello world");
    expect(deltas).toContain("world");

    // Stats show polling activated and recovered events.
    const stats = events.find((e) => e.type === "ananke:transport_stats") as {
      aguiwssPollActivations: number;
      aguiwssPollRecoveredEvents: number;
    };
    expect(stats.aguiwssPollActivations).toBeGreaterThanOrEqual(1);
    expect(stats.aguiwssPollRecoveredEvents).toBeGreaterThanOrEqual(1);
  });

  it("synthesizes RUN_FINISHED from a WSS frame's terminal status when no terminator event present", async () => {
    setRoute("/agent-1/run", () => ({ ok: true }));
    const AGUIWSSClient = await importClient();
    const client = new AGUIWSSClient(CLIENT_OPTS);
    const gen = client.message("hi");
    const drainP = drain(gen);
    const stomp = await waitForSubscription();

    stomp.deliver({
      additionalData: {
        conversationId: THREAD,
        seq: 1,
        events: [
          { type: "RUN_STARTED", runId: "r1", eventId: "e-start" },
          { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "done", eventId: "e-tmc" },
        ],
      },
    });
    // Server reports terminal status but DOES NOT include RUN_FINISHED in events.
    stomp.deliver({
      additionalData: {
        conversationId: THREAD,
        seq: 2,
        status: "input-required",
        events: [],
      },
    });

    const events = await drainP;
    const types = events.map((e) => e.type);
    expect(types[types.length - 1]).toBe("RUN_FINISHED");
    const stats = events.find((e) => e.type === "ananke:transport_stats") as {
      aguiwssStatusSynthesizedTerminators: number;
      aguiwssPollActivations: number;
    };
    expect(stats.aguiwssStatusSynthesizedTerminators).toBe(1);
    expect(stats.aguiwssPollActivations).toBe(0); // No polling needed; WSS supplied status.
  });

  it("emits RUN_ERROR with stats first when idle timeout fires before any terminator", async () => {
    setRoute("/agent-1/run", () => ({ ok: true }));
    // /connect returns nothing useful — no status, no events.
    setRoute("/agent-1/connect", () => ({ status: "working", historyEvents: [] }));

    const AGUIWSSClient = await importClient();
    const client = new AGUIWSSClient({ ...CLIENT_OPTS, timeout_ms: 300 });
    const gen = client.message("hi");
    const drainP = drain(gen);
    const stomp = await waitForSubscription();
    stomp.deliver({
      additionalData: {
        conversationId: THREAD,
        seq: 1,
        events: [{ type: "RUN_STARTED", runId: "r1", eventId: "e-start" }],
      },
    });

    const events = await drainP;
    const types = events.map((e) => e.type);
    expect(types).toContain("ananke:transport_stats");
    expect(types[types.length - 1]).toBe("RUN_ERROR");
    expect((events[events.length - 1] as { message: string }).message).toMatch(/idle timeout/);
  });
});
