import type net from 'node:net';
import type { FetchFailureReason } from '@lead-hunter/contracts';
import { Agent, request, type Dispatcher } from 'undici';
import {
  checkTarget,
  createGuardedLookup,
  isAllowedAddress,
  type GuardedLookupOptions,
  type IsAllowed,
} from './address-guard.js';

export class HttpFetchError extends Error {
  constructor(
    readonly reason: FetchFailureReason,
    readonly httpStatus?: number,
  ) {
    super(reason);
    this.name = 'HttpFetchError';
  }
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
  /** The URL that answered, after redirects. */
  url: string;
}

export interface GetOptions {
  /** The caller's deadline. Everything the call does, including waiting for a slot, ends with it. */
  signal: AbortSignal;
  accept: string;
  /** Runs before each hop, before a slot is taken. It may throw an `HttpFetchError` to refuse. */
  beforeHop?: (url: URL) => Promise<void>;
  /** S-18 D-20: a larger (or smaller) body limit than the client's, for one API request. */
  maxBytes?: number;
}

/** S-18 D-11: a JSON POST (TED search). It follows no redirects: a 3xx comes back as a status. */
export interface PostOptions {
  signal: AbortSignal;
  accept: string;
  contentType: string;
  body: string;
  maxBytes?: number;
}

export interface HttpClient {
  get(url: string, options: GetOptions): Promise<HttpResponse>;
  post(url: string, options: PostOptions): Promise<HttpResponse>;
}

export interface HttpClientOptions {
  userAgent: string;
  maxBytes: number;
  maxInFlight?: number;
  /** Test hooks: the DNS resolver and the address policy (also applied to IP-literal hosts). */
  resolve?: GuardedLookupOptions['resolve'];
  isAllowed?: IsAllowed;
  /** Test hook: replaces the guarded agent (the route tests pass a MockAgent). */
  dispatcher?: Dispatcher;
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function createSemaphore(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    async acquire(signal: AbortSignal): Promise<() => void> {
      signal.throwIfAborted();
      if (active < limit) {
        active += 1;
      } else {
        await new Promise<void>((resolve, reject) => {
          const grant = () => {
            signal.removeEventListener('abort', abort);
            resolve();
          };
          const abort = () => {
            waiting.splice(waiting.indexOf(grant), 1);
            reject(signal.reason);
          };
          waiting.push(grant);
          signal.addEventListener('abort', abort, { once: true });
        });
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = waiting.shift();
        if (next) next();
        else active -= 1;
      };
    },
  };
}

function hasBlockedAddress(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 4) return false;
  const e = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (e.code === 'ERR_BLOCKED_ADDRESS') return true;
  if (hasBlockedAddress(e.cause, depth + 1)) return true;
  return Array.isArray(e.errors) && e.errors.some((inner) => hasBlockedAddress(inner, depth + 1));
}

function mapError(error: unknown, signal: AbortSignal): HttpFetchError {
  if (error instanceof HttpFetchError) return error;
  if (signal.aborted) return new HttpFetchError('timeout');
  if (hasBlockedAddress(error)) return new HttpFetchError('blocked_address');
  return new HttpFetchError('network');
}

/** Stops reading a body; undici reports the destroy as an error event that nobody listens to. */
function discard(body: Dispatcher.ResponseData['body']): void {
  body.on('error', () => undefined);
  body.destroy();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const isAllowed = options.isAllowed ?? isAllowedAddress;
  const dispatcher: Dispatcher =
    options.dispatcher ??
    new Agent({
      connect: {
        lookup: createGuardedLookup({
          isAllowed,
          ...(options.resolve ? { resolve: options.resolve } : {}),
        }) as net.LookupFunction,
      },
    });
  const semaphore = createSemaphore(options.maxInFlight ?? 2);

  async function readBody(
    body: Dispatcher.ResponseData['body'],
    contentLength: string | undefined,
    maxBytes: number,
  ): Promise<Uint8Array> {
    const declared = contentLength === undefined ? NaN : Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      discard(body);
      throw new HttpFetchError('too_large');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > maxBytes) {
        discard(body);
        throw new HttpFetchError('too_large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  type Hop =
    | { redirect: string }
    | { redirect?: undefined; status: number; headers: HttpResponse['headers']; body: Uint8Array };

  interface HopRequest {
    signal: AbortSignal;
    accept: string;
    maxBytes?: number;
    method?: 'GET' | 'POST';
    contentType?: string;
    body?: string;
  }

  async function hop(url: URL, input: HopRequest): Promise<Hop> {
    const { signal, accept } = input;
    const release = await semaphore.acquire(signal);
    try {
      const response = await request(url, {
        dispatcher,
        method: input.method ?? 'GET',
        signal,
        headers: {
          'user-agent': options.userAgent,
          accept,
          'accept-encoding': 'identity',
          ...(input.contentType === undefined ? {} : { 'content-type': input.contentType }),
        },
        ...(input.body === undefined ? {} : { body: input.body }),
      });
      const headers = response.headers as HttpResponse['headers'];
      const location = headerValue(headers.location);
      if (input.method !== 'POST' && REDIRECT_STATUSES.has(response.statusCode) && location) {
        discard(response.body);
        return { redirect: location };
      }
      const body = await readBody(
        response.body,
        headerValue(headers['content-length']),
        input.maxBytes ?? options.maxBytes,
      );
      return { status: response.statusCode, headers, body };
    } finally {
      release();
    }
  }

  return {
    async get(rawUrl, getOptions) {
      let current: URL;
      try {
        current = new URL(rawUrl);
      } catch {
        throw new HttpFetchError('blocked_url');
      }
      try {
        for (let redirects = 0; ; redirects += 1) {
          const failure = checkTarget(current, isAllowed);
          if (failure) throw new HttpFetchError(failure);
          await getOptions.beforeHop?.(current);
          const result = await hop(current, {
            signal: getOptions.signal,
            accept: getOptions.accept,
            ...(getOptions.maxBytes === undefined ? {} : { maxBytes: getOptions.maxBytes }),
          });
          if (result.redirect === undefined) {
            return {
              status: result.status,
              headers: result.headers,
              body: result.body,
              url: current.href,
            };
          }
          if (redirects >= MAX_REDIRECTS) throw new HttpFetchError('too_many_redirects');
          try {
            current = new URL(result.redirect, current);
          } catch {
            throw new HttpFetchError('blocked_url');
          }
        }
      } catch (error) {
        throw mapError(error, getOptions.signal);
      }
    },
    async post(rawUrl, postOptions) {
      let target: URL;
      try {
        target = new URL(rawUrl);
      } catch {
        throw new HttpFetchError('blocked_url');
      }
      try {
        const failure = checkTarget(target, isAllowed);
        if (failure) throw new HttpFetchError(failure);
        const result = await hop(target, { ...postOptions, method: 'POST' });
        if (result.redirect !== undefined) throw new HttpFetchError('network');
        return {
          status: result.status,
          headers: result.headers,
          body: result.body,
          url: target.href,
        };
      } catch (error) {
        throw mapError(error, postOptions.signal);
      }
    },
  };
}
