import { z } from "zod";

const CountSchema = z.union([
  z.object({ exact: z.number() }).strict(),
  z.object({ min: z.number().optional(), max: z.number().optional() }).strict(),
]);

const RequireToolSchema = z.object({
  name: z.string(),
  count: CountSchema.optional(),
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

// Timing constraints (can be disabled with false)
const TimingAssertSchema = z.object({
  max_duration_ms: z.union([z.number(), z.literal(false)]).optional(),
  max_idle_ms: z.union([z.number(), z.literal(false)]).optional(),
}).strict();

// Text assertions (accept string or array)
const TextAssertSchema = z.object({
  must_match: z.union([z.string(), z.array(z.string())]).optional(),
  must_not_match: z.union([z.string(), z.array(z.string())]).optional(),
}).strict();

export const AssertBlockSchema = z.object({
  tools: ToolsAssertSchema.optional(),
  timing: TimingAssertSchema.optional(),
  text: TextAssertSchema.optional(),
}).strict();

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
export type TestFile = z.infer<typeof TestFileSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type UserTurn = z.infer<typeof UserTurnSchema>;
export type ConnectTurn = z.infer<typeof ConnectTurnSchema>;
export type Hook = z.infer<typeof HookSchema>;
export type RequireTool = z.infer<typeof RequireToolSchema>;
export type ForbidCall = z.infer<typeof ForbidCallSchema>;
export type CountConstraint = z.infer<typeof CountSchema>;
export type TimingAssert = z.infer<typeof TimingAssertSchema>;
export type TextAssert = z.infer<typeof TextAssertSchema>;
export type ToolsAssert = z.infer<typeof ToolsAssertSchema>;

// Type guards
export function isUserTurn(turn: Turn): turn is UserTurn {
  return "user" in turn;
}

export function isConnectTurn(turn: Turn): turn is ConnectTurn {
  return turn.type === "agui:connect";
}
