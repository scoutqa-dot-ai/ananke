import { z } from "zod";
import { AssertBlockSchema } from "./test.js";

// Re-export AssertBlockSchema as ConfigAssertBlockSchema for config usage
export const ConfigAssertBlockSchema = AssertBlockSchema;

// ---------------------------------------------------------------------------
// Template-aware assertion schemas for named assertion definitions.
// Leaf values also accept strings to allow ${param} placeholders.
// Structure (keys and nesting) is fully validated; values are relaxed.
// ---------------------------------------------------------------------------

const templateString = z.string();
const templateNumber = z.union([z.number(), templateString]);
const templatePrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const TemplateScriptSchema = z.union([
  z.string(),
  z.object({
    run: z.string(),
    timeout_ms: templateNumber.optional(),
    env: z.record(z.string()).optional(),
  }).strict(),
]);

const TemplateAssertionNodeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    // String / Array assertions
    equals: templatePrimitive.optional(),
    contains: templatePrimitive.optional(),
    starts_with: templateString.optional(),
    ends_with: templateString.optional(),
    matches: z.union([templateString, z.array(templateString)]).optional(),
    // Number assertions — accept string for ${param}
    min: templateNumber.optional(),
    max: templateNumber.optional(),
    // Array assertions
    count: TemplateAssertionNodeSchema.optional(),
    every: TemplateAssertionNodeSchema.optional(),
    some: TemplateAssertionNodeSchema.optional(),
    none: TemplateAssertionNodeSchema.optional(),
    ordered: z.array(TemplateAssertionNodeSchema).optional(),
    filter: TemplateAssertionNodeSchema.optional(),
    // Object assertions
    has_key: templateString.optional(),
    having: z.record(TemplateAssertionNodeSchema).optional(),
    // Transform
    json: TemplateAssertionNodeSchema.optional(),
    // Meta
    and: z.array(TemplateAssertionNodeSchema).optional(),
    or: z.array(TemplateAssertionNodeSchema).optional(),
    not: TemplateAssertionNodeSchema.optional(),
    // Script
    script: TemplateScriptSchema.optional(),
  }).passthrough()
);

const TemplateAssertBlockSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    text: TemplateAssertionNodeSchema.optional(),
    tool_names: TemplateAssertionNodeSchema.optional(),
    tools: TemplateAssertionNodeSchema.optional(),
    duration_ms: TemplateAssertionNodeSchema.optional(),
    idle_ms: TemplateAssertionNodeSchema.optional(),
    or: z.array(TemplateAssertBlockSchema).optional(),
    and: z.array(TemplateAssertBlockSchema).optional(),
    not: TemplateAssertBlockSchema.optional(),
    script: TemplateScriptSchema.optional(),
  }).passthrough()
);

// Named assertions: Record<name, template-aware assert block>
export const NamedAssertionsSchema = z.record(z.string(), TemplateAssertBlockSchema);

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
  assertions: NamedAssertionsSchema.optional(),
}).strict();

// Type exports
export type AGUITarget = z.infer<typeof AGUITargetSchema>;
export type AGUIWSSTarget = z.infer<typeof AGUIWSSTargetSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ConfigAssertBlock = z.infer<typeof ConfigAssertBlockSchema>;
