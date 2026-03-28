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
// Expect Block — top-level with selectors + meta combinators
// ---------------------------------------------------------------------------

export type ExpectBlockInput = {
  text?: AssertionNodeInput;
  tool_names?: AssertionNodeInput;
  tools?: AssertionNodeInput;
  response?: AssertionNodeInput;
  or?: ExpectBlockInput[];
  and?: ExpectBlockInput[];
  not?: ExpectBlockInput;
  // Script assertion at top level (operates on full step context)
  script?: string | { run: string; timeout_ms?: number; env?: Record<string, string> };
  // Named assertions (arbitrary keys resolved at evaluation time)
  [key: string]: unknown;
};

const ExpectBlockSchema: z.ZodType<ExpectBlockInput> = z.lazy(() =>
  z.object({
    text: AssertionNodeSchema.optional(),
    tool_names: AssertionNodeSchema.optional(),
    tools: AssertionNodeSchema.optional(),
    response: AssertionNodeSchema.optional(),
    or: z.array(ExpectBlockSchema).optional(),
    and: z.array(ExpectBlockSchema).optional(),
    not: ExpectBlockSchema.optional(),
    script: ScriptSchema.optional(),
  }).passthrough()
);

export { ExpectBlockSchema, AssertionNodeSchema };

// ---------------------------------------------------------------------------
// Test file structure — steps
// ---------------------------------------------------------------------------

// Message step — sends a message to the agent
const MessageStepSchema = z.object({
  type: z.literal("message").optional(),
  message: z.string(),
  expect: ExpectBlockSchema.optional(),
}).strict();

// Resume step — resume an existing thread by ID
const ResumeStepSchema = z.object({
  type: z.literal("resume"),
  resume: z.string(),
  expect: ExpectBlockSchema.optional(),
}).strict();

// Script step — runs a script to set variables (no message sent to agent)
const ScriptStepSchema = z.object({
  type: z.literal("script").optional(),
  script: ScriptSchema,
}).strict();

const StepSchema = z.union([MessageStepSchema, ResumeStepSchema, ScriptStepSchema]);

export const TestFileSchema = z.object({
  version: z.string(),
  name: z.string(),
  steps: z.array(StepSchema).min(1),
}).strict();

export type ExpectBlock = z.infer<typeof ExpectBlockSchema>;
export type AssertionNode = z.infer<typeof AssertionNodeSchema>;
export type TestFile = z.infer<typeof TestFileSchema>;
export type Step = z.infer<typeof StepSchema>;
export type MessageStep = z.infer<typeof MessageStepSchema>;
export type ResumeStep = z.infer<typeof ResumeStepSchema>;
export type ScriptStep = z.infer<typeof ScriptStepSchema>;

// Type guards
export function isMessageStep(step: Step): step is MessageStep {
  return "message" in step;
}

export function isResumeStep(step: Step): step is ResumeStep {
  return step.type === "resume";
}

export function isScriptStep(step: Step): step is ScriptStep {
  return "script" in step;
}
