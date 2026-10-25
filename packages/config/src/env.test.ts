import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigError, ENV_VARIABLES, loadConfig } from './env.js';
import { DEFAULT_LLM_PRICES } from './llm-prices.js';

const VALID_HASH = `scrypt:15:8:3:${'A'.repeat(22)}:${'B'.repeat(43)}`;
const HASH = { OPERATOR_PASSWORD_HASH: VALID_HASH };

describe('loadConfig', () => {
  it('applies the defaults', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 8080,
      dataDir: './data',
      logLevel: 'info',
      importMaxTextChars: 20_000,
      analysisDailyLimit: 20,
      prefilterMaxAgeDays: 30,
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
        IMPORT_MAX_TEXT_CHARS: '5000',
        LLM_PROVIDER: 'mock',
        ANALYSIS_DAILY_LIMIT: '5',
        PREFILTER_MAX_AGE_DAYS: '7',
        ...HASH,
      }),
    ).toEqual({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 9000,
      dataDir: '/data',
      logLevel: 'debug',
      operatorPasswordHash: VALID_HASH,
      importMaxTextChars: 5000,
      llm: { provider: 'mock' },
      analysisDailyLimit: 5,
      prefilterMaxAgeDays: 7,
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
    ['IMPORT_MAX_TEXT_CHARS', '999'],
    ['LLM_PROVIDER', 'openai'],
    ['LLM_MONTHLY_BUDGET_USD', '0'],
    ['LLM_MONTHLY_BUDGET_USD', '100001'],
    ['LLM_MONTHLY_BUDGET_USD', 'dużo'],
    ['LLM_PAID', 'yes'],
    ['LLM_JSON_MODE', 'strict'],
    ['LLM_BASE_URL', 'ftp://host'],
    ['LLM_BASE_URL', 'nie-adres'],
    ['LLM_PRICES', 'model=1'],
    ['LLM_PRICES', 'model=a/b'],
    ['ANALYSIS_DAILY_LIMIT', '0'],
    ['ANALYSIS_DAILY_LIMIT', '1001'],
    ['PREFILTER_MAX_AGE_DAYS', '0'],
    ['PREFILTER_MAX_AGE_DAYS', '366'],
    ['IMPORT_MAX_TEXT_CHARS', '200001'],
    ['IMPORT_MAX_TEXT_CHARS', 'dużo'],
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

    it.each([
      ['the old placeholder', 'placeholder'],
      ['a PHC string', '$scrypt$ln=15,r=8,p=1$c2FsdA$a2V5'],
      ['a short salt', `scrypt:15:8:3:${'A'.repeat(21)}:${'B'.repeat(43)}`],
      ['a cost above the limit', `scrypt:40:8:3:${'A'.repeat(22)}:${'B'.repeat(43)}`],
      ['a cost below the limit', `scrypt:9:8:3:${'A'.repeat(22)}:${'B'.repeat(43)}`],
      ['a block size above the limit', `scrypt:15:99:3:${'A'.repeat(22)}:${'B'.repeat(43)}`],
      ['a parallelism of zero', `scrypt:15:8:0:${'A'.repeat(22)}:${'B'.repeat(43)}`],
    ])('refuses a malformed hash: %s (FR-20 AC2)', (_name, hash) => {
      try {
        loadConfig({ OPERATOR_PASSWORD_HASH: hash });
        expect.unreachable();
      } catch (error) {
        const [issue] = (error as ConfigError).issues;
        expect(issue?.variable).toBe('OPERATOR_PASSWORD_HASH');
        expect(issue?.message).toContain('pnpm auth:hash');
      }
    });

    it('refuses 0.0.0.0 with the old placeholder', () => {
      expect(() => loadConfig({ HOST: '0.0.0.0', OPERATOR_PASSWORD_HASH: 'placeholder' })).toThrow(
        ConfigError,
      );
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

describe('loadConfig: LLM providers (D-1, D-2)', () => {
  it('leaves llm unset without LLM_PROVIDER', () => {
    expect(loadConfig({ LLM_API_KEY: 'k' })).not.toHaveProperty('llm');
  });

  it('configures anthropic with its defaults and the price table', () => {
    expect(loadConfig({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' }).llm).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      offerModel: 'claude-sonnet-5-5',
      apiKey: 'k',
      paid: true,
      prices: DEFAULT_LLM_PRICES,
      jsonMode: 'json_object',
    });
  });

  it('configures openai-compatible: key optional, free by default, offer model follows model', () => {
    expect(
      loadConfig({
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: 'http://localhost:11434/v1',
        LLM_MODEL: 'llama3.1',
        LLM_JSON_MODE: 'off',
      }).llm,
    ).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      offerModel: 'llama3.1',
      paid: false,
      prices: DEFAULT_LLM_PRICES,
      jsonMode: 'off',
    });
  });

  it('lets LLM_PAID, models and the budget override the defaults', () => {
    const llm = loadConfig({
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: 'https://api.example.test/v1',
      LLM_MODEL: 'm1',
      LLM_MODEL_OFFER: 'm2',
      LLM_PAID: 'true',
      LLM_MONTHLY_BUDGET_USD: '12.5',
    }).llm;
    expect(llm).toMatchObject({
      offerModel: 'm2',
      paid: true,
      monthlyBudgetMicroUsd: 12_500_000,
    });
    expect(
      loadConfig({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_PAID: 'false' }).llm,
    ).toMatchObject({ paid: false });
  });

  it('keeps sub-cent budgets exact as micro-USD', () => {
    const llm = loadConfig({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'k',
      LLM_MONTHLY_BUDGET_USD: '0.01',
    }).llm;
    expect(llm).toMatchObject({ monthlyBudgetMicroUsd: 10_000 });
  });

  it('merges LLM_PRICES (USD per million tokens) over the table', () => {
    const llm = loadConfig({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'k',
      LLM_PRICES: 'claude-haiku-5-5=0.2/1, my-model=0.059/0.079',
    }).llm;
    expect(llm).toMatchObject({
      prices: {
        'claude-haiku-5-5': { inputMicroUsdPerMTok: 200_000, outputMicroUsdPerMTok: 1_000_000 },
        'claude-sonnet-5-5': DEFAULT_LLM_PRICES['claude-sonnet-5-5'],
        'my-model': { inputMicroUsdPerMTok: 59_000, outputMicroUsdPerMTok: 79_000 },
      },
    });
  });

  it('ignores the other LLM variables for mock', () => {
    expect(
      loadConfig({ LLM_PROVIDER: 'mock', LLM_PRICES: 'broken', LLM_API_KEY: 'k' }).llm,
    ).toEqual({ provider: 'mock' });
  });

  it.each([
    [{ LLM_PROVIDER: 'anthropic' }, ['LLM_API_KEY']],
    [{ LLM_PROVIDER: 'openai-compatible' }, ['LLM_BASE_URL', 'LLM_MODEL']],
    [{ LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'm' }, ['LLM_BASE_URL']],
    [{ LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://x' }, ['LLM_MODEL']],
  ])('refuses to start with %j and names %j', (env, variables) => {
    try {
      loadConfig(env);
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigError).issues.map((i) => i.variable)).toEqual(variables);
      expect((error as ConfigError).issues[0]?.message).toContain('wymagany');
    }
  });

  it('never prints the API key in a configuration error', () => {
    try {
      loadConfig({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'sk-SECRET', LLM_PAID: 'maybe' });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigError).message).not.toContain('sk-SECRET');
    }
  });
});
