import { z } from 'zod';

const CountSchema = z.union([
  z.object({ exact: z.number() }),
  z.object({ min: z.number().optional(), max: z.number().optional() }),
]);

const RequireToolSchema = z.object({
  name: z.string(),
  count: CountSchema.optional(),
  args_match: z.record(z.string()).optional(),
  result_match: z.string().optional(),
  result_not_match: z.string().optional(),
  after: z.string().optional(),
});

const ForbidCallSchema = z.object({
  name: z.string(),
  args_match: z.record(z.string()).optional(),
  result_match: z.string().optional(),
});

const ToolsAssertSchema = z.object({
  forbid: z.array(z.string()).optional(),
  require: z.array(RequireToolSchema).optional(),
  forbid_calls: z.array(ForbidCallSchema).optional(),
});

const TimingAssertSchema = z.object({
  max_duration_ms: z.number().optional(),
  max_gap_ms: z.number().optional(),
});

const TextAssertSchema = z.object({
  must_match: z.string().optional(),
  must_not_match: z.string().optional(),
});

export const AssertBlockSchema = z.object({
  tools: ToolsAssertSchema.optional(),
  timing: TimingAssertSchema.optional(),
  text: TextAssertSchema.optional(),
});

const HookSchema = z.object({
  cmd: z.array(z.string()),
  timeout_ms: z.number().optional(),
});

const TurnSchema = z.object({
  user: z.string(),
  assert: AssertBlockSchema.optional(),
});

export const TestFileSchema = z.object({
  name: z.string(),
  hooks: z.array(HookSchema).optional(),
  turns: z.array(TurnSchema).min(1),
  assert: AssertBlockSchema.optional(),
});

export type AssertBlock = z.infer<typeof AssertBlockSchema>;
export type TestFile = z.infer<typeof TestFileSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type Hook = z.infer<typeof HookSchema>;
export type RequireTool = z.infer<typeof RequireToolSchema>;
export type ForbidCall = z.infer<typeof ForbidCallSchema>;
export type CountConstraint = z.infer<typeof CountSchema>;
