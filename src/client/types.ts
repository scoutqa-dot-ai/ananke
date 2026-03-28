import type { TimestampedProtocolEvent } from "./events.js";

/**
 * Common interface for all protocol clients (AG-UI, A2A, MCP)
 */
export interface ProtocolClient {
  /**
   * Send a user message and stream response events
   */
  message(text: string): AsyncGenerator<TimestampedProtocolEvent>;

  /**
   * Resume an existing thread/session without sending a message
   * Optional - not all protocols support this
   */
  resume?(): AsyncGenerator<TimestampedProtocolEvent>;

  /**
   * Close the client connection
   * Optional - not all protocols need explicit cleanup
   */
  close?(): Promise<void>;
}
