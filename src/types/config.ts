import { z } from "zod";

export const ProjectConfigSchema = z.object({
  target: z.object({
    endpoint: z.string().url(),
    headers: z.record(z.string()).optional(),

    // AG-UI specific options
    agentId: z.string().optional(),
    forwardedProps: z.record(z.unknown()).optional(),
    state: z.record(z.unknown()).optional(),
    threadId: z.string().optional(),
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
