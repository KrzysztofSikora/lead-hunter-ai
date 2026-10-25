import {
  ApiError,
  OpportunityDetail,
  OpportunityList,
  OpportunityListQuery,
  FollowUpRequest,
  NoteRequest,
  PaymentRequest,
  StatusChangeRequest,
  ValidationError,
} from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ActionResult } from './service.js';
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

  const idParams = z.object({ id: z.coerce.number().int().min(1) });
  const conflict = z
    .object({ error: z.enum(['transition_not_allowed', 'note_required']) })
    .strict();

  typed.post(
    '/api/opportunities/:id/status',
    {
      schema: {
        params: idParams,
        body: StatusChangeRequest,
        response: {
          200: OpportunityDetail,
          400: ValidationError,
          404: ApiError,
          409: conflict,
        },
      },
    },
    async (request, reply) => {
      const outcome = service.changeStatus(request.params.id, request.body);
      if (outcome.result === 'ok') return outcome.detail;
      return outcome.result === 'not_found'
        ? reply.code(404).send({ error: 'not_found' })
        : reply.code(409).send({
            error: outcome.result === 'note_required' ? 'note_required' : 'transition_not_allowed',
          });
    },
  );

  typed.post(
    '/api/opportunities/:id/notes',
    {
      schema: {
        params: idParams,
        body: NoteRequest,
        response: { 200: OpportunityDetail, 400: ValidationError, 404: ApiError },
      },
    },
    async (request, reply) => {
      const outcome = service.addNote(request.params.id, request.body);
      return outcome.result === 'ok'
        ? outcome.detail
        : reply.code(404).send({ error: 'not_found' });
    },
  );

  const invalid = (outcome: Extract<ActionResult, { result: 'invalid' }>) => ({
    error: 'validation_failed' as const,
    fields: [{ path: outcome.path, code: 'custom', message: outcome.message }],
  });

  typed.put(
    '/api/opportunities/:id/follow-up',
    {
      schema: {
        params: idParams,
        body: FollowUpRequest,
        response: {
          200: OpportunityDetail,
          400: ValidationError,
          404: ApiError,
          409: conflict,
        },
      },
    },
    async (request, reply) => {
      const outcome = service.setFollowUp(request.params.id, request.body);
      if (outcome.result === 'ok') return outcome.detail;
      if (outcome.result === 'invalid') return reply.code(400).send(invalid(outcome));
      return outcome.result === 'not_found'
        ? reply.code(404).send({ error: 'not_found' })
        : reply.code(409).send({ error: 'transition_not_allowed' });
    },
  );

  typed.post(
    '/api/opportunities/:id/payments',
    {
      schema: {
        params: idParams,
        body: PaymentRequest,
        response: { 200: OpportunityDetail, 400: ValidationError, 404: ApiError },
      },
    },
    async (request, reply) => {
      const outcome = service.addPayment(request.params.id, request.body);
      if (outcome.result === 'ok') return outcome.detail;
      return outcome.result === 'invalid'
        ? reply.code(400).send(invalid(outcome))
        : reply.code(404).send({ error: 'not_found' });
    },
  );
}
