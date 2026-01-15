import { z } from 'zod';

export const ProjectConfigSchema = z.object({
  target: z.object({
    endpoint: z.string().url(),
    headers: z.record(z.string()).optional(),
    /** Agent ID for CopilotKit transport */
    agentId: z.string().optional(),
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
