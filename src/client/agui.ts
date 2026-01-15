import type { AGUIEvent } from './events.js';

export interface AGUIClientOptions {
  endpoint: string;
  headers?: Record<string, string>;
}

export interface SendMessageOptions {
  threadId?: string;
  message: string;
}

/**
 * AG-UI SSE client for communicating with AG-UI endpoints
 */
export class AGUIClient {
  private endpoint: string;
  private headers: Record<string, string>;

  constructor(options: AGUIClientOptions) {
    this.endpoint = options.endpoint;
    this.headers = options.headers ?? {};
  }

  /**
   * Send a message and stream events via SSE
   */
  async *sendMessage(options: SendMessageOptions): AsyncGenerator<AGUIEvent> {
    const body = JSON.stringify({
      threadId: options.threadId,
      messages: [
        {
          role: 'user',
          content: options.message,
        },
      ],
    });

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...this.headers,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `AG-UI request failed: ${response.status} ${response.statusText}\n${text}`
      );
    }

    if (!response.body) {
      throw new Error('No response body from AG-UI endpoint');
    }

    yield* this.parseSSEStream(response.body);
  }

  /**
   * Parse SSE stream into AG-UI events
   */
  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>
  ): AsyncGenerator<AGUIEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete events (separated by double newlines)
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const eventBlock of events) {
          const event = this.parseEvent(eventBlock);
          if (event) {
            yield event;
          }
        }
      }

      // Process any remaining data
      if (buffer.trim()) {
        const event = this.parseEvent(buffer);
        if (event) {
          yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse a single SSE event block
   */
  private parseEvent(eventBlock: string): AGUIEvent | null {
    const lines = eventBlock.split('\n');
    let eventType: string | null = null;
    let data: string | null = null;

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice(5).trim();
      }
    }

    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      // If event type is specified, override the type in data
      if (eventType && parsed.type !== eventType) {
        parsed.type = eventType;
      }
      return parsed as AGUIEvent;
    } catch {
      // Not valid JSON, skip
      return null;
    }
  }
}
