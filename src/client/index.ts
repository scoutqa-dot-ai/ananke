import type { ProjectConfig, Target } from "../types/config.js";
import { AGUIClient } from "./agui.js";
import type { ProtocolClient } from "./types.js";

export * from "./agui.js";
export * from "./events.js";
export * from "./types.js";

export interface CreateClientOptions {
  onDebug?: (message: string) => void;
}

/**
 * Create a protocol client based on target type
 */
export function createClient(
  config: ProjectConfig,
  options: CreateClientOptions = {}
): ProtocolClient {
  const target = config.target;

  switch (target.type) {
    case "agui":
      // TypeScript narrows target to AGUITarget here
      return new AGUIClient({
        endpoint: target.endpoint,
        agentId: target.agentId,
        headers: target.headers,
        threadId: target.threadId,
        forwardedProps: target.forwardedProps,
        state: target.state,
        onDebug: options.onDebug,
      });

    // Future target types:
    // case 'a2a':
    //   return new A2AClient({ ... });
    // case 'mcp':
    //   return new MCPClient({ ... });

    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = target;
      throw new Error(`Unknown target type: ${(_exhaustive as Target).type}`);
  }
}
