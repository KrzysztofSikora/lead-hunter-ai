import { z } from 'zod';

export const LoginRequest = z.object({ password: z.string().min(1).max(1024) }).strict();
export type LoginRequest = z.infer<typeof LoginRequest>;

export const SessionResponse = z.object({ authenticated: z.literal(true) }).strict();
export type SessionResponse = z.infer<typeof SessionResponse>;

export const ApiError = z.object({ error: z.string() }).strict();
export type ApiError = z.infer<typeof ApiError>;

export const ThrottledError = z
  .object({
    error: z.literal('too_many_attempts'),
    retryAfterSeconds: z.number().int().nonnegative(),
  })
  .strict();
export type ThrottledError = z.infer<typeof ThrottledError>;
