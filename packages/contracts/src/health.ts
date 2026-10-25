import { z } from 'zod';

export const HealthResponse = z
  .object({
    status: z.enum(['ok', 'degraded']),
    version: z.string(),
    uptimeSeconds: z.number().int().nonnegative(),
    db: z
      .object({
        status: z.enum(['ok', 'error']),
        migrations: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponse>;
