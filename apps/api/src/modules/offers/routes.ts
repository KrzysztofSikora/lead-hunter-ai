import {
  ApiError,
  OfferDraftFailed,
  OfferDraftRefused,
  OpportunityDetail,
  ValidationError,
} from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OfferService } from './service.js';

export function registerOfferRoutes(app: FastifyInstance, service: OfferService): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // Synchronous: the request waits for the provider (S-07 D-5). Nothing is ever sent to a client.
  typed.post(
    '/api/opportunities/:id/offer-drafts',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().min(1) }),
        response: {
          201: OpportunityDetail,
          400: ValidationError,
          404: ApiError,
          409: OfferDraftRefused,
          502: OfferDraftFailed,
        },
      },
    },
    async (request, reply) => {
      const outcome = await service.generate(request.params.id);
      switch (outcome.result) {
        case 'ok':
          return reply.code(201).send(outcome.detail);
        case 'not_found':
          return reply.code(404).send({ error: 'not_found' });
        case 'refused':
          return reply.code(409).send({ error: outcome.code });
        case 'failed':
          return reply.code(502).send({ error: 'provider_failed', reason: outcome.reason });
      }
    },
  );
}
