import fastifyStatic from '@fastify/static';
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
  /** Directory of the built web app; static serving and the SPA fallback are off without it. */
  webDistDir?: string;
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

  if (deps.webDistDir) {
    await app.register(fastifyStatic, { root: deps.webDistDir, wildcard: false });
  }

  // `/api/*` stays JSON; any other GET falls back to the SPA shell (D-12).
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const isApi = path === '/api' || path.startsWith('/api/');
    const isAsset = path.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(path);
    if (deps.webDistDir && request.method === 'GET' && !isApi && !isAsset) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  await app.ready();
  return app;
}
