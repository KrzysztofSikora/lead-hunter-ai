import { PipelineResponse } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createPipelineService, type PipelineDeps } from './service.js';

export function registerPipelineRoutes(app: FastifyInstance, deps: PipelineDeps): void {
  const service = createPipelineService(deps);
  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/api/pipeline', { schema: { response: { 200: PipelineResponse } } }, async () =>
      service.summary(),
    );
}
