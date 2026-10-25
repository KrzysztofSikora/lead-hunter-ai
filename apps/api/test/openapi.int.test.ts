import { describe, expect, it } from 'vitest';
import { buildTestApp, loginAsOperator } from './helpers/app.js';

// `:id` in Fastify and `{id}` in OpenAPI name the same route.
const normalise = (url: string): string => url.replace(/:(\w+)/g, '{$1}');

describe('OpenAPI document (FR-25 AC3)', () => {
  it('lists exactly the registered, non-hidden routes', async () => {
    const routes: string[] = [];
    const { app } = await buildTestApp({
      overrides: {
        onRoute: ({ method, url, hidden }) => {
          if (!hidden && method !== 'HEAD') routes.push(`${method} ${normalise(url)}`);
        },
      },
    });
    const documented = Object.entries(app.swagger().paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item ?? {}).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(routes.length).toBeGreaterThan(0);
    expect(documented.sort()).toEqual(routes.sort());
  });

  it('serves the document outside production', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      url: '/api/openapi.json',
      headers: { cookie: await loginAsOperator(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().paths['/api/health']).toBeDefined();
  });

  it('does not serve the document in production', async () => {
    const { app } = await buildTestApp({ env: { NODE_ENV: 'production' } });
    expect((await app.inject('/api/openapi.json')).statusCode).toBe(404);
  });
});
