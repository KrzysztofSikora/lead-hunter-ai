import { HealthResponse } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { HealthProbe } from './ports.js';

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: { probe: HealthProbe; version: string },
): void {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/api/health',
      { schema: { response: { 200: HealthResponse, 503: HealthResponse } } },
      async (_request, reply) => {
        const { ok, migrations } = deps.probe.check();
        const body = {
          status: ok ? ('ok' as const) : ('degraded' as const),
          version: deps.version,
          uptimeSeconds: Math.floor(process.uptime()),
          db: { status: ok ? ('ok' as const) : ('error' as const), migrations },
        };
        return reply.code(ok ? 200 : 503).send(body);
      },
    );
}
