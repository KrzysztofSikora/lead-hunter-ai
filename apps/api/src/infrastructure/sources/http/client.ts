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
  /**
   * S-19 D-9: extra request headers (a token). Sent on the first hop and on same-origin
   * redirects only; dropped when a redirect changes the origin.
   */
  headers?: Record<string, string>;
}

export interface HttpClient {
  get(url: string, options: GetOptions): Promise<HttpResponse>;
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
  ): Promise<Uint8Array> {
    const declared = contentLength === undefined ? NaN : Number(contentLength);
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      discard(body);
      throw new HttpFetchError('too_large');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > options.maxBytes) {
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

  async function hop(
    url: URL,
    { signal, accept }: GetOptions,
    extraHeaders: Record<string, string>,
  ): Promise<Hop> {
    const release = await semaphore.acquire(signal);
    try {
      const response = await request(url, {
        dispatcher,
        method: 'GET',
        signal,
        headers: {
          ...extraHeaders,
          'user-agent': options.userAgent,
          accept,
          'accept-encoding': 'identity',
        },
      });
      const headers = response.headers as HttpResponse['headers'];
      const location = headerValue(headers.location);
      if (REDIRECT_STATUSES.has(response.statusCode) && location) {
        discard(response.body);
        return { redirect: location };
      }
      const body = await readBody(response.body, headerValue(headers['content-length']));
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
      const origin = current.origin;
      let extraHeaders = getOptions.headers ?? {};
      try {
        for (let redirects = 0; ; redirects += 1) {
          const failure = checkTarget(current, isAllowed);
          if (failure) throw new HttpFetchError(failure);
          await getOptions.beforeHop?.(current);
          // Once a redirect leaves the origin the headers are gone for good, even on a way back.
          if (current.origin !== origin) extraHeaders = {};
          const result = await hop(current, getOptions, extraHeaders);
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
  };
}
