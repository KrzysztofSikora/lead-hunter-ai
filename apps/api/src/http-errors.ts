import type { ValidationError } from '@lead-hunter/contracts';
import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

type Field = ValidationError['fields'][number];

const dotPath = (instancePath: string): string => instancePath.split('/').filter(Boolean).join('.');
const join = (parent: string, key: string): string => (parent ? `${parent}.${key}` : key);

/**
 * D-5: every schema validation error (Zod, on any route) becomes 400 `ValidationError` with one
 * entry per field. Other errors, including malformed JSON, keep Fastify's default handling.
 */
export function registerValidationErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (!hasZodFastifySchemaValidationErrors(error)) throw error;
    const fields: Field[] = error.validation.flatMap((issue): Field[] => {
      const path = dotPath(issue.instancePath);
      const keys = (issue.params as { keys?: unknown }).keys;
      if (issue.keyword === 'unrecognized_keys' && Array.isArray(keys)) {
        return keys.map((key) => ({
          path: join(path, String(key)),
          code: 'unrecognized_keys',
          message: issue.message ?? 'nieznane pole',
        }));
      }
      return [{ path, code: issue.keyword, message: issue.message ?? '' }];
    });
    return reply.code(400).send({ error: 'validation_failed', fields });
  });
}
