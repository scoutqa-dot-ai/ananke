import { z } from "zod";

// Timing constraints (can be disabled with false)
const TimingSchema = z.object({
  max_duration_ms: z.union([z.number(), z.literal(false)]).optional(),
  max_idle_ms: z.union([z.number(), z.literal(false)]).optional(),
}).strict();

// Text assertions (accept string or array)
const TextAssertSchema = z.object({
  must_match: z.union([z.string(), z.array(z.string())]).optional(),
  must_not_match: z.union([z.string(), z.array(z.string())]).optional(),
}).strict();

// Tool assertions
const RequireToolSchema = z.object({
  name: z.string(),
  count: z
    .union([
      z.object({ exact: z.number() }).strict(),
      z.object({ min: z.number().optional(), max: z.number().optional() }).strict(),
    ])
    .optional(),
  args_match: z.record(z.string()).optional(),
  result_match: z.string().optional(),
  result_not_match: z.string().optional(),
  after: z.string().optional(),
}).strict();

const ForbidCallSchema = z.object({
  name: z.string(),
  args_match: z.record(z.string()).optional(),
  result_match: z.string().optional(),
}).strict();

const ToolsAssertSchema = z.object({
  forbid: z.array(z.string()).optional(),
  require: z.array(RequireToolSchema).optional(),
  forbid_calls: z.array(ForbidCallSchema).optional(),
}).strict();

// AssertBlock schema (used at target, test, and turn levels)
export const ConfigAssertBlockSchema = z.object({
  tools: ToolsAssertSchema.optional(),
  timing: TimingSchema.optional(),
  text: TextAssertSchema.optional(),
}).strict();

// Common fields shared across all target types
const CommonTargetFields = {
  headers: z.record(z.string()).optional(),
  timeout_ms: z.number().optional(),
  assert: ConfigAssertBlockSchema.optional(),
};

// AG-UI target (flat - all fields at same level as type)
const AGUITargetSchema = z.object({
  type: z.literal("agui"),
  ...CommonTargetFields,
  // AG-UI specific fields
  endpoint: z.string().url(),
  agentId: z.string(),
  threadId: z.string().optional(),
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
  threadId: z.string().optional(),
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
}).strict();

// Type exports
export type AGUITarget = z.infer<typeof AGUITargetSchema>;
export type AGUIWSSTarget = z.infer<typeof AGUIWSSTargetSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ConfigAssertBlock = z.infer<typeof ConfigAssertBlockSchema>;
