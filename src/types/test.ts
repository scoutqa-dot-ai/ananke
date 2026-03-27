import { z } from "zod";

// ---------------------------------------------------------------------------
// Assertion Node — recursive type for the v2 assertion tree
// ---------------------------------------------------------------------------

const NumberAssertionSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
}).strict();

// Forward-declare for recursive references (exported for DTS generation)
export type AssertionNodeInput = {
  // String / Array
  equals?: string | number | boolean | null;
  contains?: string | number | boolean;
  starts_with?: string;
  ends_with?: string;
  matches?: string | string[];
  // Number
  min?: number;
  max?: number;
  // Array
  count?: AssertionNodeInput;
  every?: AssertionNodeInput;
  some?: AssertionNodeInput;
  none?: AssertionNodeInput;
  ordered?: AssertionNodeInput[];
  filter?: AssertionNodeInput;
  // Object
  has_key?: string;
  having?: Record<string, AssertionNodeInput>;
  // Transform
  json?: AssertionNodeInput;
  // Meta
  and?: AssertionNodeInput[];
  or?: AssertionNodeInput[];
  not?: AssertionNodeInput;
  script?: string | { run: string; timeout_ms?: number; env?: Record<string, string> };
  // Named assertions (arbitrary keys resolved at evaluation time)
  [key: string]: unknown;
};

// Script operator: string (short form) or object (long form)
const ScriptSchema = z.union([
  z.string(),
  z.object({
    run: z.string(),
    timeout_ms: z.number().optional(),
    env: z.record(z.string()).optional(),
  }).strict(),
]);

const AssertionNodeSchema: z.ZodType<AssertionNodeInput> = z.lazy(() =>
  z.object({
    // String / Array assertions
    equals: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    contains: z.union([z.string(), z.number(), z.boolean()]).optional(),
    starts_with: z.string().optional(),
    ends_with: z.string().optional(),
    matches: z.union([z.string(), z.array(z.string())]).optional(),
    // Number assertions
    min: z.number().optional(),
    max: z.number().optional(),
    // Array assertions
    count: AssertionNodeSchema.optional(),
    every: AssertionNodeSchema.optional(),
    some: AssertionNodeSchema.optional(),
    none: AssertionNodeSchema.optional(),
    ordered: z.array(AssertionNodeSchema).optional(),
    filter: AssertionNodeSchema.optional(),
    // Object assertions
    has_key: z.string().optional(),
    having: z.record(AssertionNodeSchema).optional(),
    // Transform
    json: AssertionNodeSchema.optional(),
    // Meta
    and: z.array(AssertionNodeSchema).optional(),
    or: z.array(AssertionNodeSchema).optional(),
    not: AssertionNodeSchema.optional(),
    // Script assertion
    script: ScriptSchema.optional(),
  }).passthrough()
);

// ---------------------------------------------------------------------------
// Assert Block — top-level with selectors + meta combinators
// ---------------------------------------------------------------------------

export type AssertBlockInput = {
  text?: AssertionNodeInput;
  tool_names?: AssertionNodeInput;
  tools?: AssertionNodeInput;
  response?: AssertionNodeInput;
  or?: AssertBlockInput[];
  and?: AssertBlockInput[];
  not?: AssertBlockInput;
  // Script assertion at top level (operates on full step context)
  script?: string | { run: string; timeout_ms?: number; env?: Record<string, string> };
  // Named assertions (arbitrary keys resolved at evaluation time)
  [key: string]: unknown;
};

const AssertBlockSchema: z.ZodType<AssertBlockInput> = z.lazy(() =>
  z.object({
    text: AssertionNodeSchema.optional(),
    tool_names: AssertionNodeSchema.optional(),
    tools: AssertionNodeSchema.optional(),
    response: AssertionNodeSchema.optional(),
    or: z.array(AssertBlockSchema).optional(),
    and: z.array(AssertBlockSchema).optional(),
    not: AssertBlockSchema.optional(),
    script: ScriptSchema.optional(),
  }).passthrough()
);

export { AssertBlockSchema, AssertionNodeSchema };

// ---------------------------------------------------------------------------
// Test file structure — steps replace turns + hooks
// ---------------------------------------------------------------------------

// User message step — sends a message to the agent
const UserStepSchema = z.object({
  type: z.literal("user").optional(),
  user: z.string(),
  assert: AssertBlockSchema.optional(),
}).strict();

// AG-UI connect step (connect to existing thread without sending message)
const ConnectStepSchema = z.object({
  type: z.literal("agui:connect"),
  assert: AssertBlockSchema.optional(),
}).strict();

// Script step — runs a script to set variables (no message sent to agent)
const ScriptStepSchema = z.object({
  type: z.literal("script").optional(),
  script: ScriptSchema,
}).strict();

const StepSchema = z.union([UserStepSchema, ConnectStepSchema, ScriptStepSchema]);

export const TestFileSchema = z.object({
  version: z.string(),
  name: z.string(),
  steps: z.array(StepSchema).min(1),
  assert: AssertBlockSchema.optional(),
}).strict();

export type AssertBlock = z.infer<typeof AssertBlockSchema>;
export type AssertionNode = z.infer<typeof AssertionNodeSchema>;
export type TestFile = z.infer<typeof TestFileSchema>;
export type Step = z.infer<typeof StepSchema>;
export type UserStep = z.infer<typeof UserStepSchema>;
export type ConnectStep = z.infer<typeof ConnectStepSchema>;
export type ScriptStep = z.infer<typeof ScriptStepSchema>;

// Type guards
export function isUserStep(step: Step): step is UserStep {
  return "user" in step;
}

export function isConnectStep(step: Step): step is ConnectStep {
  return step.type === "agui:connect";
}

export function isScriptStep(step: Step): step is ScriptStep {
  return "script" in step;
}
