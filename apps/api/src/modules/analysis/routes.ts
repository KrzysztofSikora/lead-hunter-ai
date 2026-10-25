import { AnalysisServiceStatus } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

export interface AnalysisRouteDeps {
  status(): AnalysisServiceStatus;
}

export function registerAnalysisRoutes(app: FastifyInstance, deps: AnalysisRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/analysis/status',
    { schema: { response: { 200: AnalysisServiceStatus } } },
    async () => deps.status(),
  );
}
