import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import { ApiError, LoginRequest, SessionResponse, ThrottledError } from '@lead-hunter/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createAuthService, SESSION_IDLE_MS, type AuthDeps } from './service.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Routes that answer without an operator session; everything else under /api/ requires one. */
    public?: boolean;
  }
}

export const SESSION_COOKIE = 'lh_session';
const z204 = z.null().describe('No content');
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const isLoopback = (ip: string): boolean =>
  ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.');

/** D-6: `Secure` only behind a loopback proxy (tailscale serve) that says it speaks https. */
function isSecureRequest(request: FastifyRequest): boolean {
  const forwarded = request.headers['x-forwarded-proto'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return isLoopback(request.ip) && first === 'https';
}

const isThrottled = (error: unknown): error is ThrottledError =>
  typeof error === 'object' &&
  error !== null &&
  (error as { error?: unknown }).error === 'too_many_attempts';

export async function registerAuth(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const service = createAuthService(deps);

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });

  const setSessionCookie = (request: FastifyRequest, reply: FastifyReply, token: string): void => {
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: isSecureRequest(request),
      maxAge: SESSION_IDLE_MS / 1000,
    });
  };

  // Deny by default (D-5). The decision rests on the matched route pattern, never on the raw
  // URL: find-my-way decodes `/%61pi/...` before matching.
  app.addHook('onRequest', async (request, reply) => {
    if (request.is404) return;
    const { url, config } = request.routeOptions;
    if (!url?.startsWith('/api/') || config?.public) return;
    const token = request.cookies[SESSION_COOKIE];
    const result = service.authenticate(token);
    if (!result.valid) return reply.code(401).send({ error: 'unauthorized' });
    if (result.refreshCookie && token) setSessionCookie(request, reply, token);
  });

  const typed = app.withTypeProvider<ZodTypeProvider>();

  // The rate limiter throws its response object, which Fastify's default handler would replace
  // with its own error shape; a scoped handler lets the contract body through.
  await app.register(async (scope) => {
    scope.setErrorHandler((error, _request, reply) => {
      if (isThrottled(error)) {
        const { retryAfterSeconds } = error;
        return reply.code(429).send({ error: 'too_many_attempts', retryAfterSeconds });
      }
      throw error;
    });
    const scoped = scope.withTypeProvider<ZodTypeProvider>();
    scoped.post(
      '/api/auth/login',
      {
        config: {
          public: true,
          rateLimit: {
            max: LOGIN_MAX_ATTEMPTS,
            timeWindow: LOGIN_WINDOW_MS,
            // One key for everybody (D-4): behind Tailscale/Docker all peers look alike.
            keyGenerator: () => 'login',
            errorResponseBuilder: (_request, context) => ({
              statusCode: 429,
              error: 'too_many_attempts',
              retryAfterSeconds: Math.ceil(context.ttl / 1000),
            }),
          },
        },
        schema: {
          body: LoginRequest,
          response: { 204: z204, 401: ApiError, 429: ThrottledError, 503: ApiError },
        },
      },
      async (request, reply) => {
        const result = await service.login(request.body.password);
        if (!result.ok) {
          return result.reason === 'not_configured'
            ? reply.code(503).send({ error: 'auth_not_configured' })
            : reply.code(401).send({ error: 'invalid_password' });
        }
        setSessionCookie(request, reply, result.token);
        return reply.code(204).send(null);
      },
    );
  });

  typed.post(
    '/api/auth/logout',
    { schema: { response: { 204: z204 } } },
    async (request, reply) => {
      service.logout(request.cookies[SESSION_COOKIE]);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(204).send(null);
    },
  );

  typed.get(
    '/api/auth/session',
    { schema: { response: { 200: SessionResponse, 401: ApiError } } },
    async () => ({ authenticated: true as const }),
  );
}
