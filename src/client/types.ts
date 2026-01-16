import type { AGUIEvent } from "./events.js";

/**
 * Options for sending a message to the protocol client
 */
export interface SendMessageOptions {
  message: string;
}

/**
 * Common interface for all protocol clients (AG-UI, A2A, MCP)
 */
export interface ProtocolClient {
  /**
   * Send a user message and stream response events
   */
  sendMessage(options: SendMessageOptions): AsyncGenerator<AGUIEvent>;

  /**
   * Connect to existing thread/session without sending a message
   * Optional - not all protocols support this
   */
  connect?(): AsyncGenerator<AGUIEvent>;

  /**
   * Close the client connection
   * Optional - not all protocols need explicit cleanup
   */
  close?(): Promise<void>;
}
