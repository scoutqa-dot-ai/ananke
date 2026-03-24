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
};

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
  }).strict()
);

// ---------------------------------------------------------------------------
// Assert Block — top-level with selectors + meta combinators
// ---------------------------------------------------------------------------

export type AssertBlockInput = {
  text?: AssertionNodeInput;
  tool_names?: AssertionNodeInput;
  tools?: AssertionNodeInput;
  duration_ms?: AssertionNodeInput;
  idle_ms?: AssertionNodeInput;
  or?: AssertBlockInput[];
  and?: AssertBlockInput[];
  not?: AssertBlockInput;
};

const AssertBlockSchema: z.ZodType<AssertBlockInput> = z.lazy(() =>
  z.object({
    text: AssertionNodeSchema.optional(),
    tool_names: AssertionNodeSchema.optional(),
    tools: AssertionNodeSchema.optional(),
    duration_ms: AssertionNodeSchema.optional(),
    idle_ms: AssertionNodeSchema.optional(),
    or: z.array(AssertBlockSchema).optional(),
    and: z.array(AssertBlockSchema).optional(),
    not: AssertBlockSchema.optional(),
  }).strict()
);

export { AssertBlockSchema };

// ---------------------------------------------------------------------------
// Test file structure
// ---------------------------------------------------------------------------

const HookSchema = z.object({
  cmd: z.array(z.string()),
  timeout_ms: z.number().optional(),
  env: z.record(z.string()).optional(),
}).strict();

// User message turn
const UserTurnSchema = z.object({
  type: z.literal("user").optional(),
  user: z.string(),
  assert: AssertBlockSchema.optional(),
}).strict();

// AG-UI connect turn (connect to existing thread without sending message)
const ConnectTurnSchema = z.object({
  type: z.literal("agui:connect"),
  assert: AssertBlockSchema.optional(),
}).strict();

const TurnSchema = z.union([UserTurnSchema, ConnectTurnSchema]);

export const TestFileSchema = z.object({
  version: z.string(),
  name: z.string(),
  hooks: z.array(HookSchema).optional(),
  turns: z.array(TurnSchema).min(1),
  assert: AssertBlockSchema.optional(),
}).strict();

export type AssertBlock = z.infer<typeof AssertBlockSchema>;
export type AssertionNode = z.infer<typeof AssertionNodeSchema>;
export type TestFile = z.infer<typeof TestFileSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type UserTurn = z.infer<typeof UserTurnSchema>;
export type ConnectTurn = z.infer<typeof ConnectTurnSchema>;
export type Hook = z.infer<typeof HookSchema>;

// Type guards
export function isUserTurn(turn: Turn): turn is UserTurn {
  return "user" in turn;
}

export function isConnectTurn(turn: Turn): turn is ConnectTurn {
  return turn.type === "agui:connect";
}
