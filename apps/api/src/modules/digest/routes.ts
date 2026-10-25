import { DigestQuery, DigestToday, ValidationError } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createDigestService, type DigestDeps } from './service.js';

export function registerDigestRoutes(app: FastifyInstance, deps: DigestDeps): void {
  const service = createDigestService(deps);
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/digest/today',
    {
      schema: {
        querystring: DigestQuery,
        response: { 200: DigestToday, 400: ValidationError },
      },
    },
    async (request) => service.today(request.query),
  );
}
