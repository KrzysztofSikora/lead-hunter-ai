import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import type { Config } from '@lead-hunter/config';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { registerValidationErrorHandler } from './http-errors.js';
import { registerAnalysisRoutes, type AnalysisRouteDeps } from './modules/analysis/routes.js';
import { registerJobRoutes, type ScheduleInfo } from './modules/jobs/routes.js';
import type { JobsService } from './modules/jobs/service.js';
import { registerAuth } from './modules/auth/routes.js';
import type { AuthDeps } from './modules/auth/service.js';
import { registerDataRoutes } from './modules/ownership/routes.js';
import type { DataService } from './modules/ownership/service.js';
import { registerDigestRoutes } from './modules/digest/routes.js';
import type { DigestDeps } from './modules/digest/service.js';
import { registerInsightsRoutes } from './modules/insights/routes.js';
import type { InsightsDeps } from './modules/insights/service.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import type { HealthProbe } from './modules/health/ports.js';
import { registerOfferRoutes } from './modules/offers/routes.js';
import type { OfferService } from './modules/offers/service.js';
import { registerOpportunityRoutes } from './modules/opportunities/routes.js';
import type { OpportunityDeps } from './modules/opportunities/service.js';
import { registerPipelineRoutes } from './modules/pipeline/routes.js';
import type { PipelineDeps } from './modules/pipeline/service.js';
import { registerProfileRoutes } from './modules/profile/routes.js';
import type { ProfileDeps } from './modules/profile/service.js';
import { registerSourceRoutes } from './modules/sources/routes.js';
import type { SourceService } from './modules/sources/service.js';
import { registerSignalRoutes } from './modules/signals/routes.js';
import type { SignalDeps } from './modules/signals/service.js';

export interface AppDeps {
  config: Pick<Config, 'nodeEnv' | 'importMaxTextChars'>;
  healthProbe: HealthProbe;
  auth: AuthDeps;
  profile: ProfileDeps;
  signals: SignalDeps;
  opportunities: OpportunityDeps;
  pipeline: PipelineDeps;
  digest: DigestDeps;
  insights: InsightsDeps;
  analysis: AnalysisRouteDeps;
  offers: OfferService;
  data: DataService;
  sources: SourceService;
  jobs: JobsService;
  schedule: ScheduleInfo;
  /** Called after an import created a new opportunity; the analysis runner is kicked here (D-4). */
  onSignalCreated?: () => void;
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

  registerValidationErrorHandler(app);

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

  // The guard hook must exist before the routes it protects are registered.
  await registerAuth(app, deps.auth);

  registerHealthRoutes(app, { probe: deps.healthProbe, version: deps.version });
  registerProfileRoutes(app, deps.profile);
  registerSignalRoutes(app, {
    ...deps.signals,
    importMaxTextChars: deps.config.importMaxTextChars,
    ...(deps.onSignalCreated ? { onCreated: deps.onSignalCreated } : {}),
  });

  registerOpportunityRoutes(app, deps.opportunities);
  registerPipelineRoutes(app, deps.pipeline);
  registerDigestRoutes(app, deps.digest);
  registerInsightsRoutes(app, deps.insights);
  registerAnalysisRoutes(app, deps.analysis);
  registerOfferRoutes(app, deps.offers);
  registerDataRoutes(app, deps.data);
  registerSourceRoutes(app, deps.sources, deps.jobs);
  registerJobRoutes(app, { jobs: deps.jobs, schedule: deps.schedule });

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
