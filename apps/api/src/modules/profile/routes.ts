import { OperatorProfile, ProfileResponse, ValidationError } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createProfileService, type ProfileDeps, type StoredProfile } from './service.js';

const toResponse = ({ profile, example, updatedAt }: StoredProfile): ProfileResponse => ({
  profile,
  example,
  updatedAt: updatedAt.toISOString(),
});

export function registerProfileRoutes(app: FastifyInstance, deps: ProfileDeps): void {
  const service = createProfileService(deps);
  service.ensureExample();

  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/profile', { schema: { response: { 200: ProfileResponse } } }, async () =>
    toResponse(service.get()),
  );

  typed.put(
    '/api/profile',
    { schema: { body: OperatorProfile, response: { 200: ProfileResponse, 400: ValidationError } } },
    async (request) => toResponse(service.save(request.body)),
  );
}
