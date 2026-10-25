import { AnalysisServiceStatus, RetryAnalysisResult } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export interface AnalysisRouteDeps {
  status(): AnalysisServiceStatus;
  retry(id: number): 'reset' | 'not_failed' | 'not_found';
}

export function registerAnalysisRoutes(app: FastifyInstance, deps: AnalysisRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/analysis/status',
    { schema: { response: { 200: AnalysisServiceStatus } } },
    async () => deps.status(),
  );

  // Brief §15, D-12: only a failed analysis can be retried; a completed one is never redone.
  typed.post(
    '/api/opportunities/:id/analyze',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: {
          202: RetryAnalysisResult,
          404: z.object({ error: z.literal('not_found') }).strict(),
          409: z.object({ error: z.literal('not_failed') }).strict(),
        },
      },
    },
    async (request, reply) => {
      const outcome = deps.retry(request.params.id);
      if (outcome === 'reset') return reply.code(202).send({ analysisStatus: 'PENDING' });
      return reply.code(outcome === 'not_found' ? 404 : 409).send({ error: outcome } as never);
    },
  );
}
