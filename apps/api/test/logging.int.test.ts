import { loadConfig } from '@lead-hunter/config';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createLoggerOptions } from '../src/infrastructure/logging/logger.js';

describe('logger redaction (FR-24 AC2)', () => {
  it('never lets a configured secret reach the log output', async () => {
    const config = loadConfig({ HOST: '0.0.0.0', OPERATOR_PASSWORD_HASH: 'hash-LEAK-CANARY' });
    const lines: string[] = [];
    const { stream, ...options } = createLoggerOptions(config, {
      write: (line: string) => void lines.push(line),
    });
    const app = Fastify({ logger: { ...options, ...(stream ? { stream } : {}) } });
    app.get('/ping', async (request) => {
      request.log.info(
        { req: { headers: request.headers }, nested: { token: 'token-LEAK-CANARY' } },
        'handling',
      );
      return { ok: true };
    });

    app.log.info({ operatorPasswordHash: config.operatorPasswordHash }, 'config');
    app.log.info({ apiKey: 'key-LEAK-CANARY', password: 'pw-LEAK-CANARY' }, 'top level');
    app.log.info({ llm: { apiKey: 'nested-key-LEAK-CANARY' } }, 'nested');
    app.log.info(
      {
        req: {
          headers: {
            cookie: 'session=cookie-LEAK-CANARY',
            authorization: 'Bearer auth-LEAK-CANARY',
          },
        },
      },
      'direct headers',
    );
    await app.inject({
      url: '/ping',
      headers: { cookie: 'session=cookie-LEAK-CANARY', authorization: 'Bearer auth-LEAK-CANARY' },
    });
    await app.close();

    const output = lines.join('');
    expect(lines.length).toBeGreaterThan(4);
    expect(output).not.toContain('LEAK-CANARY');
    expect(output).toContain('[REDACTED]');
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});
