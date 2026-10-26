import {
  CreateSourceRequest,
  Source,
  SourceHealth,
  SourceList,
  SourceRunResult,
  UpdateSourceRequest,
  ValidationError,
} from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { JobsService } from '../jobs/service.js';
import type { Refusal, SourceService } from './service.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const NotFound = z.object({ error: z.literal('not_found') }).strict();
const Refused = z.union([
  z.object({ error: z.literal('busy') }).strict(),
  z.object({ error: z.literal('too_soon'), nextAllowedAt: z.iso.datetime() }).strict(),
  z.object({ error: z.literal('disabled') }).strict(),
]);
const CreateRefused = z.object({ error: z.literal('exists') }).strict();
const NotTenderSource = z.object({ error: z.literal('not_tender_source') }).strict();
const NotGithubSource = z.object({ error: z.literal('not_github_source') }).strict();
const BadPreset = z.object({ error: z.literal('unknown_preset') }).strict();

function refusal(refused: Refusal) {
  switch (refused.kind) {
    case 'not_found':
      return { status: 404 as const, body: { error: 'not_found' as const } };
    case 'disabled':
      return { status: 409 as const, body: { error: 'disabled' as const } };
    case 'too_soon':
      return {
        status: 409 as const,
        body: { error: 'too_soon' as const, nextAllowedAt: refused.nextAllowedAt },
      };
  }
}

/** D-10: brief §15. Runs are synchronous (D-7): the answer carries the result. */
export function registerSourceRoutes(
  app: FastifyInstance,
  service: SourceService,
  jobs: JobsService,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/sources', { schema: { response: { 200: SourceList } } }, async () =>
    service.list(),
  );

  typed.post(
    '/api/sources',
    {
      schema: {
        body: CreateSourceRequest,
        response: { 201: Source, 400: z.union([ValidationError, BadPreset]), 409: CreateRefused },
      },
    },
    async (request, reply) => {
      const outcome = service.create(request.body);
      switch (outcome.kind) {
        case 'created':
          return reply.code(201).send(outcome.source);
        case 'exists':
          return reply.code(409).send({ error: 'exists' });
        case 'unknown_preset':
          return reply.code(400).send({ error: 'unknown_preset' });
        case 'invalid':
          return reply.code(400).send({
            error: 'validation_failed',
            fields: outcome.issues.map((message) => ({ path: 'url', code: 'invalid', message })),
          });
      }
    },
  );

  typed.patch(
    '/api/sources/:id',
    {
      schema: {
        params: IdParams,
        body: UpdateSourceRequest,
        response: {
          200: Source,
          400: z.union([ValidationError, NotTenderSource, NotGithubSource]),
          404: NotFound,
        },
      },
    },
    async (request, reply) => {
      const outcome = service.update(request.params.id, request.body);
      switch (outcome.kind) {
        case 'updated':
          return outcome.source;
        case 'not_found':
          return reply.code(404).send({ error: 'not_found' });
        case 'not_tender_source':
          return reply.code(400).send({ error: 'not_tender_source' });
        case 'not_github_source':
          return reply.code(400).send({ error: 'not_github_source' });
        case 'invalid':
          return reply.code(400).send({
            error: 'validation_failed',
            fields: outcome.issues.map((message) => ({
              path: request.body.github === undefined ? 'tender' : 'github',
              code: 'invalid',
              message,
            })),
          });
      }
    },
  );

  typed.post(
    '/api/sources/:id/run',
    {
      schema: {
        params: IdParams,
        response: { 200: SourceRunResult, 404: NotFound, 409: Refused },
      },
    },
    async (request, reply) => {
      // D-4: a source run takes the same lock as a cycle.
      const started = await jobs.runSource(request.params.id);
      if (started.kind === 'busy') return reply.code(409).send({ error: 'busy' });
      const { outcome } = started;
      if (outcome.kind === 'done') return outcome.result;
      const { status, body } = refusal(outcome);
      return reply.code(status).send(body as never);
    },
  );

  typed.post(
    '/api/sources/:id/check',
    {
      schema: {
        params: IdParams,
        response: { 200: SourceHealth, 404: NotFound, 409: Refused },
      },
    },
    async (request, reply) => {
      const outcome = await service.check(request.params.id);
      if (outcome.kind === 'done') return outcome.health;
      const { status, body } = refusal(outcome);
      return reply.code(status).send(body as never);
    },
  );
}
