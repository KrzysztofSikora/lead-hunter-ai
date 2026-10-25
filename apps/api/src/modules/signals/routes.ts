import { ImportResult, importRequestSchema, ValidationError } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createSignalService, type SignalDeps } from './service.js';

export function registerSignalRoutes(
  app: FastifyInstance,
  deps: SignalDeps & { importMaxTextChars: number; onCreated?: () => void },
): void {
  const service = createSignalService(deps);
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/api/signals/import',
    {
      schema: {
        body: importRequestSchema(deps.importMaxTextChars),
        response: { 200: ImportResult, 201: ImportResult, 422: ImportResult, 400: ValidationError },
      },
    },
    async (request, reply) => {
      const result = await service.importSignal(request.body);
      if (result.result === 'created') deps.onCreated?.();
      const status = ({ created: 201, duplicate: 200, fetch_failed: 422 } as const)[result.result];
      return reply.code(status).send(result);
    },
  );
}
