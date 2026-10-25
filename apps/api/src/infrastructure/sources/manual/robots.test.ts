import { describe, expect, it } from 'vitest';
import { HttpFetchError, type HttpClient, type HttpResponse } from '../http/client.js';
import { createRobotsCheck, ROBOTS_CACHE_MS } from './robots.js';

const response = (status: number, body = ''): HttpResponse => ({
  status,
  headers: {},
  body: new TextEncoder().encode(body),
  url: 'https://example.com/robots.txt',
});

function setup(answer: () => HttpResponse | Error) {
  const requests: string[] = [];
  let now = 1_000_000;
  const http: HttpClient = {
    async get(url) {
      requests.push(url);
      const result = answer();
      if (result instanceof Error) throw result;
      return result;
    },
  };
  const robots = createRobotsCheck({
    http,
    userAgentToken: 'LeadHunterAI',
    clock: { now: () => new Date(now) },
  });
  const signal = new AbortController().signal;
  const check = (path: string) => robots.check(new URL(`https://example.com${path}`), signal);
  return { requests, check, advance: (ms: number) => (now += ms) };
}

const reasonOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => 'allowed',
    (error: unknown) => (error as HttpFetchError).reason,
  );

describe('robots.txt check (S-09 D-7)', () => {
  it('matches the product token LeadHunterAI', async () => {
    const { check } = setup(() =>
      response(200, 'User-agent: LeadHunterAI\nDisallow: /private\n\nUser-agent: *\nAllow: /'),
    );
    expect(await reasonOf(check('/private/offer'))).toBe('robots_disallowed');
    expect(await reasonOf(check('/public'))).toBe('allowed');
  });

  it('honours a wildcard group', async () => {
    const { check } = setup(() => response(200, 'User-agent: *\nDisallow: /'));
    expect(await reasonOf(check('/a'))).toBe('robots_disallowed');
  });

  it('treats 4xx as no restrictions', async () => {
    const { check } = setup(() => response(404));
    expect(await reasonOf(check('/a'))).toBe('allowed');
  });

  it('treats 5xx and an unreachable file as a complete disallow, without caching', async () => {
    let answer: HttpResponse | Error = response(503);
    const { check, requests } = setup(() => answer);
    expect(await reasonOf(check('/a'))).toBe('robots_unavailable');
    answer = new HttpFetchError('network');
    expect(await reasonOf(check('/a'))).toBe('robots_unavailable');
    answer = new HttpFetchError('too_large');
    expect(await reasonOf(check('/a'))).toBe('robots_unavailable');
    answer = response(200, '');
    expect(await reasonOf(check('/a'))).toBe('allowed');
    expect(requests).toHaveLength(4);
  });

  it('lets guard and deadline errors through unchanged', async () => {
    for (const reason of ['blocked_address', 'blocked_url', 'timeout'] as const) {
      const { check } = setup(() => new HttpFetchError(reason));
      expect(await reasonOf(check('/a'))).toBe(reason);
    }
  });

  it('asks once per origin for 24 hours, then again', async () => {
    const { check, requests, advance } = setup(() => response(200, 'User-agent: *\nAllow: /'));
    await check('/a');
    await check('/b');
    expect(requests).toEqual(['https://example.com/robots.txt']);
    advance(ROBOTS_CACHE_MS - 1);
    await check('/c');
    expect(requests).toHaveLength(1);
    advance(1);
    await check('/d');
    expect(requests).toHaveLength(2);
  });

  it('caches a 4xx outcome too', async () => {
    const { check, requests } = setup(() => response(410));
    await check('/a');
    await check('/b');
    expect(requests).toHaveLength(1);
  });
});
