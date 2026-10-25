import swagger from '@fastify/swagger';
import type { Config } from '@lead-hunter/config';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { registerHealthRoutes } from './modules/health/routes.js';
import type { HealthProbe } from './modules/health/ports.js';

export interface AppDeps {
  config: Pick<Config, 'nodeEnv'>;
  healthProbe: HealthProbe;
  version: string;
  logger?: FastifyServerOptions['logger'];
  /** Called for every registered route; the OpenAPI test uses it to compare against the document. */
  onRoute?: (route: { method: string; url: string; hidden: boolean }) => void;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (deps.onRoute) {
    const onRoute = deps.onRoute;
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        onRoute({ method, url: route.url, hidden: Boolean(route.schema?.hide) });
      }
    });
  }

  await app.register(swagger, {
    openapi: { info: { title: 'Lead Hunter AI', version: deps.version } },
    transform: jsonSchemaTransform,
  });

  registerHealthRoutes(app, { probe: deps.healthProbe, version: deps.version });

  if (deps.config.nodeEnv !== 'production') {
    app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  }

  // Static serving and the SPA fallback (D-12) replace this for non-/api paths in Phase 4.
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));

  await app.ready();
  return app;
}
