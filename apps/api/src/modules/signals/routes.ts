import { ImportResult, importRequestSchema, ValidationError } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createSignalService, type SignalDeps } from './service.js';

export function registerSignalRoutes(
  app: FastifyInstance,
  deps: SignalDeps & { importMaxTextChars: number },
): void {
  const service = createSignalService(deps);
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/api/signals/import',
    {
      schema: {
        body: importRequestSchema(deps.importMaxTextChars),
        response: { 200: ImportResult, 201: ImportResult, 400: ValidationError },
      },
    },
    async (request, reply) => {
      const result = service.importSignal(request.body);
      return reply.code(result.result === 'created' ? 201 : 200).send(result);
    },
  );
}
