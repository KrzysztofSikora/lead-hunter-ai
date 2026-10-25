import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigError, ENV_VARIABLES, loadConfig } from './env.js';

const HASH = { OPERATOR_PASSWORD_HASH: 'placeholder' };

describe('loadConfig', () => {
  it('applies the defaults', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 8080,
      dataDir: './data',
      logLevel: 'info',
    });
  });

  it('reads every variable', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '9000',
        DATA_DIR: '/data',
        LOG_LEVEL: 'debug',
        ...HASH,
      }),
    ).toEqual({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 9000,
      dataDir: '/data',
      logLevel: 'debug',
      operatorPasswordHash: 'placeholder',
    });
  });

  it('treats an empty string as unset', () => {
    const config = loadConfig({ PORT: '', HOST: '', LOG_LEVEL: '', OPERATOR_PASSWORD_HASH: '' });
    expect(config.port).toBe(8080);
    expect(config.host).toBe('127.0.0.1');
    expect(config).not.toHaveProperty('operatorPasswordHash');
  });

  it('ignores variables outside the schema', () => {
    expect(() => loadConfig({ LOG_LEVL: 'debug', PATH: '/bin' })).not.toThrow();
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['PORT', '0'],
    ['PORT', '80.5'],
    ['NODE_ENV', 'prod'],
    ['LOG_LEVEL', 'loud'],
  ])('rejects %s=%s and names the variable', (variable, value) => {
    const run = () => loadConfig({ [variable]: value });
    expect(run).toThrow(ConfigError);
    try {
      run();
    } catch (error) {
      const issues = (error as ConfigError).issues;
      expect(issues.map((i) => i.variable)).toEqual([variable]);
      expect((error as ConfigError).message).toContain(variable);
      expect((error as ConfigError).message).toContain('Błąd konfiguracji');
    }
  });

  it.each(['development', 'test', 'production'])('accepts NODE_ENV=%s', (value) => {
    expect(loadConfig({ NODE_ENV: value }).nodeEnv).toBe(value);
  });

  it.each([
    ['PORT', 'abc', '1–65535'],
    ['NODE_ENV', 'prod', 'production'],
    ['LOG_LEVEL', 'loud', 'trace, silent'],
  ])('explains the expected values for %s=%s', (variable, value, hint) => {
    try {
      loadConfig({ [variable]: value });
      expect.unreachable();
    } catch (error) {
      const [issue] = (error as ConfigError).issues;
      expect(issue?.message).toContain('oczekiwano');
      expect(issue?.message).toContain(hint);
      expect((error as ConfigError).name).toBe('ConfigError');
      expect((error as ConfigError).message).toContain(`  ${variable} — ${issue?.message}`);
    }
  });

  it('reports all invalid variables at once', () => {
    try {
      loadConfig({ PORT: 'x', NODE_ENV: 'y' });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigError).issues.map((i) => i.variable)).toEqual(['NODE_ENV', 'PORT']);
      expect((error as ConfigError).message.split('\n')).toHaveLength(3);
    }
  });

  describe('non-loopback host (FR-23 AC4)', () => {
    it('refuses 0.0.0.0 without a password hash', () => {
      expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(/OPERATOR_PASSWORD_HASH/);
    });

    it('names the host in the refusal', () => {
      try {
        loadConfig({ HOST: '10.0.0.5' });
        expect.unreachable();
      } catch (error) {
        const [issue] = (error as ConfigError).issues;
        expect(issue).toMatchObject({ variable: 'OPERATOR_PASSWORD_HASH' });
        expect(issue?.message).toContain('10.0.0.5');
        expect(issue?.message).not.toContain('oczekiwano');
      }
    });

    it('refuses 0.0.0.0 with an empty hash', () => {
      expect(() => loadConfig({ HOST: '0.0.0.0', OPERATOR_PASSWORD_HASH: '' })).toThrow(
        ConfigError,
      );
    });

    it('accepts 0.0.0.0 with a hash', () => {
      expect(loadConfig({ HOST: '0.0.0.0', ...HASH }).host).toBe('0.0.0.0');
    });

    it.each(['127.0.0.1', '::1', 'localhost'])('accepts %s without a hash', (host) => {
      expect(loadConfig({ HOST: host }).host).toBe(host);
    });
  });
});

describe('ENV_VARIABLES', () => {
  it('lists every variable in .env.example (FR-23 AC2)', () => {
    const template = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    for (const name of ENV_VARIABLES) {
      expect(template, name).toMatch(new RegExp(`^#?\\s*${name}=`, 'm'));
    }
  });
});
