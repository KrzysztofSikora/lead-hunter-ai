import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { OpportunityAnalysis } from '@lead-hunter/contracts';
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/infrastructure/llm/anthropic.js';
import { OpenAiCompatibleProvider } from '../src/infrastructure/llm/openai-compatible.js';
import { SYSTEM_PROMPT } from '../src/infrastructure/llm/prompt.js';
import { type AnalysisInput, ProviderError } from '../src/modules/analysis/ports.js';

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/llm/${name}`, import.meta.url)), 'utf8');
const json = (name: string): unknown => JSON.parse(read(name));

const KEY = 'sk-test-CANARY-0000';
let ANTHROPIC = '';
let COMPAT = '';
let sequence = 0;
const JSON_HEADERS = { 'content-type': 'application/json' };

const injection = read('synthetic-injection.txt').trim();
const input: AnalysisInput = {
  schemaVersion: 1,
  source: {
    title: 'DEMO post',
    text: injection,
    url: 'https://example.invalid/post/7',
    sourceType: 'manual_text',
  },
  profile: {
    skills: ['TypeScript'],
    serviceTypes: ['DASHBOARD'],
    preferredTechnologies: [],
    excludedTechnologies: [],
    languages: ['pl'],
    rateRanges: [],
  },
};

const agent = getGlobalDispatcher() as MockAgent;

interface Captured {
  body: string;
  headers: Record<string, string>;
}
let requests: Captured[] = [];

const servers: Server[] = [];
afterAll(() => {
  for (const server of servers) server.close();
});

/**
 * The mock dispatcher hides request bodies, so tests that read what was sent talk to a real
 * server on loopback; this is the only network connection a test may open.
 */
async function capture(responseBody: unknown): Promise<string> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
      });
      res.writeHead(200, JSON_HEADERS).end(JSON.stringify(responseBody));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  agent.enableNetConnect(host);
  return `http://${host}`;
}

function intercept(base: string, path: string) {
  return agent.get(base).intercept({ path, method: 'POST' });
}

function reply(
  base: string,
  path: string,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  intercept(base, path)
    .reply((options) => {
      requests.push({
        body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
        headers: options.headers as Record<string, string>,
      });
      return {
        statusCode: status,
        data: typeof body === 'string' ? body : JSON.stringify(body),
        responseOptions: { headers: { ...JSON_HEADERS, ...headers } },
      };
    })
    .persist();
}

// A fresh origin per test, so interceptors never leak into the next one.
beforeEach(() => {
  sequence += 1;
  ANTHROPIC = `https://api-${sequence}.anthropic.test`;
  COMPAT = `http://llm-${sequence}.test:11434`;
  requests = [];
});

const anthropic = (options: { maxRetries?: number; timeoutMs?: number } = {}) =>
  new AnthropicProvider({
    apiKey: KEY,
    baseUrl: ANTHROPIC,
    model: 'claude-haiku-5-5',
    paid: true,
    timeoutMs: options.timeoutMs ?? 5000,
    maxRetries: options.maxRetries ?? 0,
  });

const compat = (
  options: { maxRetries?: number; timeoutMs?: number; jsonMode?: 'json_object' | 'off' } = {},
) =>
  new OpenAiCompatibleProvider({
    apiKey: KEY,
    baseUrl: `${COMPAT}/v1`,
    model: 'demo-model',
    paid: false,
    jsonMode: options.jsonMode ?? 'json_object',
    timeoutMs: options.timeoutMs ?? 5000,
    maxRetries: options.maxRetries ?? 0,
  });

const kindOf = async (promise: Promise<unknown>): Promise<string> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  return error instanceof ProviderError ? error.message : `not a ProviderError: ${String(error)}`;
};

const MESSAGES = '/v1/messages';
const CHAT = '/v1/chat/completions';

describe('Anthropic adapter', () => {
  it('returns the parsed output and the usage', async () => {
    reply(ANTHROPIC, MESSAGES, 200, json('anthropic-valid.json'));
    const result = await anthropic().analyzeOpportunity(input);
    expect(result.usage).toEqual({ inputTokens: 1234, outputTokens: 567 });
    expect(OpportunityAnalysis.safeParse(result.output).success).toBe(true);
  });

  it('sends the source only inside the escaped data block, and no key, tools or URL', async () => {
    const base = await capture(json('anthropic-valid.json'));
    await new AnthropicProvider({
      apiKey: KEY,
      baseUrl: base,
      model: 'claude-haiku-5-5',
      paid: true,
      timeoutMs: 5000,
      maxRetries: 0,
    }).analyzeOpportunity(input);
    const sent = requests[0]!;
    const body = JSON.parse(sent.body) as Record<string, unknown>;
    expect(sent.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(sent.body).not.toContain(KEY);
    expect(sent.body).not.toContain('/post/7');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('temperature');
    expect(String(body['system']).startsWith(SYSTEM_PROMPT)).toBe(true);
    const messages = body['messages'] as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    const content = messages[0]!.content;
    expect(content.startsWith('<source_data>\n')).toBe(true);
    expect(content.match(/<\/source_data>/g)).toHaveLength(1);
    expect(content).toContain('Ignore all previous instructions');
    expect(String(body['system'])).not.toContain('Ignore all previous instructions');
    const config = body['output_config'] as { format: { type: string }; effort: string };
    expect(config.format.type).toBe('json_schema');
    expect(config.effort).toBe('low');
  });

  it.each([
    ['anthropic-not-json.json', 200, 'not_json'],
    ['anthropic-refusal.json', 200, 'refusal'],
    ['anthropic-truncated.json', 200, 'truncated'],
  ])('maps %s', async (file, status, expected) => {
    reply(ANTHROPIC, MESSAGES, status, json(file));
    const outcome = await anthropic()
      .analyzeOpportunity(input)
      .then(
        () => 'ok',
        (e: unknown) => (e instanceof ProviderError ? e.message : (e as Error).name),
      );
    expect(outcome).toBe(expected);
  });

  it.each([
    [401, 'auth 401'],
    [403, 'auth 403'],
    [429, 'rate_limited 429'],
    [500, 'unavailable 500'],
    [400, 'bad_request 400'],
  ])('maps HTTP %i without leaking the body', async (status, expected) => {
    reply(ANTHROPIC, MESSAGES, status, {
      type: 'error',
      error: { type: 'x', message: `body quotes ${KEY} and source text` },
    });
    const message = await kindOf(anthropic().analyzeOpportunity(input));
    expect(message).toBe(expected);
  });

  it('retries 429 up to maxRetries and no more', async () => {
    reply(
      ANTHROPIC,
      MESSAGES,
      429,
      { type: 'error', error: { type: 'x', message: 'slow' } },
      {
        'retry-after': '0',
      },
    );
    await kindOf(anthropic({ maxRetries: 1 }).analyzeOpportunity(input));
    expect(requests).toHaveLength(2);
    requests = [];
    await kindOf(anthropic({ maxRetries: 0 }).analyzeOpportunity(input));
    expect(requests).toHaveLength(1);
  });

  it('times out', async () => {
    intercept(ANTHROPIC, MESSAGES)
      .reply(200, JSON.stringify(json('anthropic-valid.json')))
      .delay(500);
    const message = await kindOf(anthropic({ timeoutMs: 50 }).analyzeOpportunity(input));
    expect(message).toBe('timeout');
  });
});

describe('OpenAI-compatible adapter', () => {
  it('returns the parsed output and the usage', async () => {
    reply(COMPAT, CHAT, 200, json('openai-valid.json'));
    const result = await compat().analyzeOpportunity(input);
    expect(result.usage).toEqual({ inputTokens: 321, outputTokens: 123 });
    expect(OpportunityAnalysis.safeParse(result.output).success).toBe(true);
  });

  it('reports null usage when the server sends none', async () => {
    reply(COMPAT, CHAT, 200, json('openai-no-usage.json'));
    const result = await compat().analyzeOpportunity(input);
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null });
  });

  it('accepts an answer in a code fence', async () => {
    reply(COMPAT, CHAT, 200, json('openai-fenced.json'));
    const result = await compat().analyzeOpportunity(input);
    expect(OpportunityAnalysis.safeParse(result.output).success).toBe(true);
  });

  it('maps finish_reason length to truncated', async () => {
    reply(COMPAT, CHAT, 200, json('openai-length.json'));
    expect(await kindOf(compat().analyzeOpportunity(input))).toBe('truncated');
  });

  it.each([
    [401, 'auth 401'],
    [429, 'rate_limited 429'],
    [500, 'unavailable 500'],
  ])('maps HTTP %i', async (status, expected) => {
    reply(COMPAT, CHAT, status, { error: { message: `quotes ${KEY}` } });
    expect(await kindOf(compat().analyzeOpportunity(input))).toBe(expected);
  });

  it('times out', async () => {
    intercept(COMPAT, CHAT)
      .reply(200, JSON.stringify(json('openai-valid.json')))
      .delay(500);
    expect(await kindOf(compat({ timeoutMs: 50 }).analyzeOpportunity(input))).toBe('timeout');
  });

  it('sends json_object unless the mode is off, and nothing but the fragment', async () => {
    const base = await capture(json('openai-valid.json'));
    const make = (jsonMode: 'json_object' | 'off') =>
      new OpenAiCompatibleProvider({
        apiKey: KEY,
        baseUrl: `${base}/v1`,
        model: 'demo-model',
        paid: false,
        jsonMode,
        timeoutMs: 5000,
        maxRetries: 0,
      });
    await make('json_object').analyzeOpportunity(input);
    await make('off').analyzeOpportunity(input);
    const [on, off] = requests.map((r) => JSON.parse(r.body) as Record<string, unknown>);
    expect(on!['response_format']).toEqual({ type: 'json_object' });
    expect(off).not.toHaveProperty('response_format');
    expect(on).not.toHaveProperty('tools');
    expect(requests[0]!.body).not.toContain(KEY);
    expect(requests[0]!.body).not.toContain('/post/7');
    expect(requests[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
    const user = (on!['messages'] as { role: string; content: string }[]).find(
      (m) => m.role === 'user',
    )!;
    expect(user.content.match(/<\/source_data>/g)).toHaveLength(1);
  });
});
