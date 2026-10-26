import { ApiError, DataExport, ValidationError } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DataService } from './service.js';

export function registerDataRoutes(app: FastifyInstance, service: DataService): void {
  // S-15 D-9: removal is final; nothing is returned.
  app.withTypeProvider<ZodTypeProvider>().delete(
    '/api/opportunities/:id',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().min(1) }),
        response: { 204: z.null(), 400: ValidationError, 404: ApiError },
      },
    },
    async (request, reply) =>
      service.deleteOpportunity(request.params.id)
        ? reply.code(204).send(null)
        : reply.code(404).send({ error: 'not_found' }),
  );

  // S-15 D-8: built in memory first, so an error never sends a partial file.
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/export',
    { schema: { response: { 200: DataExport } } },
    async (_request, reply) => {
      const { body, date } = service.exportData();
      return reply
        .header('content-disposition', `attachment; filename="lead-hunter-export-${date}.json"`)
        .send(body);
    },
  );
}
