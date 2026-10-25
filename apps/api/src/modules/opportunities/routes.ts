import {
  ApiError,
  OpportunityDetail,
  OpportunityList,
  OpportunityListQuery,
  ValidationError,
} from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createOpportunityService, type OpportunityDeps } from './service.js';

export function registerOpportunityRoutes(app: FastifyInstance, deps: OpportunityDeps): void {
  const service = createOpportunityService(deps);
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/api/opportunities',
    {
      schema: {
        querystring: OpportunityListQuery,
        response: { 200: OpportunityList, 400: ValidationError },
      },
    },
    async (request) => service.list(request.query),
  );

  typed.get(
    '/api/opportunities/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().min(1) }),
        response: { 200: OpportunityDetail, 400: ValidationError, 404: ApiError },
      },
    },
    async (request, reply) => {
      const found = service.get(request.params.id);
      return found ?? reply.code(404).send({ error: 'not_found' });
    },
  );
}
