import { Insights, InsightsQuery, ValidationError } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createInsightsService, type InsightsDeps } from './service.js';

export function registerInsightsRoutes(app: FastifyInstance, deps: InsightsDeps): void {
  const service = createInsightsService(deps);
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/insights',
    {
      schema: {
        querystring: InsightsQuery,
        response: { 200: Insights, 400: ValidationError },
      },
    },
    async (request) => service.get(request.query),
  );
}
