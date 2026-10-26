import {
  AnalysisActivity,
  AnalysisCancelResult,
  AnalysisRequestBody,
  AnalysisRequestRefused,
  AnalysisRequestResult,
  AnalysisResumeResult,
  AnalysisServiceStatus,
  ApiError,
  RetryAnalysisResult,
  ValidationError,
} from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export interface AnalysisRouteDeps {
  status(): AnalysisServiceStatus;
  activity(): Promise<AnalysisActivity>;
  cancel(): { cancelled: boolean };
  resume(): void;
  requeue(id: number, force: boolean): 'queued' | 'prefiltered' | 'not_configured' | 'not_found';
  retry(id: number): 'reset' | 'not_failed' | 'not_found';
}

export function registerAnalysisRoutes(app: FastifyInstance, deps: AnalysisRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/analysis/status',
    { schema: { response: { 200: AnalysisServiceStatus } } },
    async () => deps.status(),
  );

  typed.get(
    '/api/analysis/activity',
    { schema: { response: { 200: AnalysisActivity } } },
    async () => deps.activity(),
  );

  typed.post(
    '/api/analysis/cancel',
    { schema: { response: { 200: AnalysisCancelResult } } },
    async () => ({ ...deps.cancel(), paused: true as const }),
  );

  typed.post(
    '/api/analysis/resume',
    { schema: { response: { 200: AnalysisResumeResult } } },
    async () => {
      deps.resume();
      return { paused: false as const };
    },
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
