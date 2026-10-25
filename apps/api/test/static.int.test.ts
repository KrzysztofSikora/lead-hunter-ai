import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers/app.js';

describe('static serving and SPA fallback (D-12)', () => {
  let webDir: string;
  beforeEach(() => {
    webDir = mkdtempSync(join(tmpdir(), 'lh-web-'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>shell</title>');
  });
  afterEach(() => rmSync(webDir, { recursive: true, force: true }));

  it('serves index.html at / and for unknown view paths', async () => {
    const { app } = await buildTestApp({ overrides: { webDistDir: webDir } });
    for (const url of ['/', '/some/view']) {
      const res = await app.inject(url);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<title>shell</title>');
    }
  });

  it('keeps /api/* JSON 404 and the health route working', async () => {
    const { app } = await buildTestApp({ overrides: { webDistDir: webDir } });
    const res = await app.inject('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
    expect((await app.inject('/api/health')).statusCode).toBe(200);
  });

  it('answers /api and missing assets with the JSON 404, not the shell', async () => {
    const { app } = await buildTestApp({ overrides: { webDistDir: webDir } });
    for (const url of ['/api', '/api?x=1', '/assets/nope.js', '/favicon.ico']) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('does not serve a shell without a web dist', async () => {
    const { app } = await buildTestApp();
    expect((await app.inject('/')).statusCode).toBe(404);
  });
});
