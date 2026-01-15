import { z } from 'zod';

export const ProjectConfigSchema = z.object({
  target: z.object({
    endpoint: z.string().url(),
    headers: z.record(z.string()).optional(),
    /** Agent ID for CopilotKit transport */
    agentId: z.string().optional(),
    /** Initial state for the agent */
    state: z.record(z.unknown()).optional(),
    /** Forwarded props passed to the agent */
    forwardedProps: z.record(z.unknown()).optional(),
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
