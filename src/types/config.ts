import { z } from "zod";

// Named assertions: Record<name, expect block definition>.
// Definitions may contain ${param} placeholders in any position, so we
// validate structure only at resolution/evaluation time — not at load time.
// This avoids maintaining a duplicate "template-aware" schema that drifts
// from ExpectBlockSchema whenever operators are added or changed.
export const NamedAssertionsSchema = z.record(z.string(), z.unknown());

// Common fields shared across all target types
const CommonTargetFields = {
  headers: z.record(z.string()).optional(),
  timeout_ms: z.number().optional(),
};

// AG-UI target (flat - all fields at same level as type)
const AGUITargetSchema = z.object({
  type: z.literal("agui"),
  ...CommonTargetFields,
  // AG-UI specific fields
  endpoint: z.string().url(),
  agentId: z.string(),
  forwardedProps: z.record(z.unknown()).optional(),
  state: z.record(z.unknown()).optional(),
}).strict();

// AG-UI over WebSocket/STOMP target
const AGUIWSSTargetSchema = z.object({
  type: z.literal("aguiwss"),
  ...CommonTargetFields,
  // HTTP endpoint for sending messages
  endpoint: z.string().url(),
  agentId: z.string(),
  forwardedProps: z.record(z.unknown()).optional(),
  state: z.record(z.unknown()).optional(),
  // WebSocket/STOMP options for receiving events
  wsUrl: z.string().startsWith("wss://").or(z.string().startsWith("ws://")),
  wsTopic: z.string().startsWith("/"),
  wsHeaders: z.record(z.string()).optional(),
  wsStompHeaders: z.record(z.string()).optional(),
}).strict();

// Future: A2A target
// const A2ATargetSchema = z.object({
//   type: z.literal("a2a"),
//   ...CommonTargetFields,
//   agentCardUrl: z.string().url().optional(),
//   endpoint: z.string().url().optional(),
//   contextId: z.string().optional(),
//   ...
// });

// Discriminated union on "type" field
const TargetSchema = z.discriminatedUnion("type", [
  AGUITargetSchema,
  AGUIWSSTargetSchema,
  // A2ATargetSchema,
  // MCPTargetSchema,
]);

export const ProjectConfigSchema = z.object({
  version: z.string(),
  target: TargetSchema,
  assertions: NamedAssertionsSchema.optional(),
}).strict();

// Type exports
export type AGUITarget = z.infer<typeof AGUITargetSchema>;
export type AGUIWSSTarget = z.infer<typeof AGUIWSSTargetSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
