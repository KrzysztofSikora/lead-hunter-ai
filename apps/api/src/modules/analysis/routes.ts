import {
  AnalysisRequestBody,
  AnalysisRequestRefused,
  AnalysisRequestResult,
  AnalysisServiceStatus,
  ApiError,
  ValidationError,
} from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export interface AnalysisRouteDeps {
  status(): AnalysisServiceStatus;
  requeue(id: number, force: boolean): 'queued' | 'prefiltered' | 'not_configured' | 'not_found';
}

export function registerAnalysisRoutes(app: FastifyInstance, deps: AnalysisRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/analysis/status',
    { schema: { response: { 200: AnalysisServiceStatus } } },
    async () => deps.status(),
  );

  typed.post(
    '/api/opportunities/:id/analysis',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().min(1) }),
        body: AnalysisRequestBody.nullish(),
        response: {
          202: AnalysisRequestResult,
          400: ValidationError,
          404: ApiError,
          409: AnalysisRequestRefused,
        },
      },
    },
    async (request, reply) => {
      const force = request.body?.force ?? false;
      const outcome = deps.requeue(request.params.id, force);
      if (outcome === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (outcome !== 'queued') return reply.code(409).send({ error: outcome });
      return reply.code(202).send({ result: 'queued', force });
    },
  );
}
