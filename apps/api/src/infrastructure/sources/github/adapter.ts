import { GithubSearchConfig } from '@lead-hunter/contracts';
import type { Clock } from '../../../modules/shared/clock.js';
import type { AdapterOutcome, FeedItem, SourceAdapter } from '../../../modules/sources/ports.js';
import type { HttpClient } from '../http/client.js';
import { createGithubApi, type GithubApi } from './api.js';
import { mapIssue } from './map-issue.js';
import { buildQueries, searchPath } from './query.js';

/** D-5: 10 searches a minute without a token, 30 with one; the gaps keep a run well inside. */
export const SEARCH_SPACING_MS = { anonymous: 6_100, token: 2_100 } as const;

export interface GithubAdapterDeps {
  http: HttpClient;
  clock: Clock;
  timeoutMs: number;
  maxAttempts: number;
  maxTextChars: number;
  token?: string | undefined;
  sleep?: (ms: number) => Promise<void>;
  logger?: { warn(message: string): void };
  /** Tests: an API helper with its own settings. */
  api?: GithubApi;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** S-19 D-3, D-4: open issues with a bounty label, one search per configured language. */
export function createGithubAdapter(deps: GithubAdapterDeps): SourceAdapter<GithubSearchConfig> {
  const sleep = deps.sleep ?? defaultSleep;
  const api =
    deps.api ??
    createGithubApi({
      http: deps.http,
      clock: deps.clock,
      timeoutMs: deps.timeoutMs,
      maxAttempts: deps.maxAttempts,
      token: deps.token,
      sleep,
    });
  const spacing = deps.token ? SEARCH_SPACING_MS.token : SEARCH_SPACING_MS.anonymous;

  async function discover(config: GithubSearchConfig): Promise<AdapterOutcome> {
    const queries = buildQueries(config);
    const items = new Map<string, FeedItem>();
    let skipped = 0;
    for (const [index, query] of queries.entries()) {
      if (index > 0) await sleep(spacing);
      const result = await api.get(searchPath(query));
      if (!result.ok) {
        // Plan-review 3: what earlier queries found is kept, and the run is `partial`.
        if (index === 0) return result;
        deps.logger?.warn(
          `github search: query ${index + 1} failed ${result.reason}${result.httpStatus === undefined ? '' : ` ${result.httpStatus}`}`,
        );
        return { ok: true, items: [...items.values()], skipped, truncated: true };
      }
      const page = result.json as { items?: unknown; incomplete_results?: unknown } | null;
      if (page === null || typeof page !== 'object' || !Array.isArray(page.items)) {
        if (index === 0) return { ok: false, reason: 'invalid_feed' };
        deps.logger?.warn(`github search: query ${index + 1} failed invalid_feed`);
        return { ok: true, items: [...items.values()], skipped, truncated: true };
      }
      if (page.incomplete_results === true) deps.logger?.warn('github search: incomplete_results');
      for (const raw of page.items) {
        const mapped = mapIssue(raw, {
          platform: 'github',
          language: query.language,
          maxTextChars: deps.maxTextChars,
        });
        if (mapped === 'pull_request') continue;
        if (mapped === 'invalid') {
          skipped += 1;
          continue;
        }
        if (mapped.key !== null && !items.has(mapped.key)) items.set(mapped.key, mapped);
      }
    }
    return { ok: true, items: [...items.values()], skipped };
  }

  return {
    type: 'github',
    validateConfig(config) {
      const parsed = GithubSearchConfig.safeParse(config);
      if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
      return { ok: true, config: parsed.data, key: 'github' };
    },
    discover,
    async healthCheck(config) {
      const first = buildQueries(config)[0];
      if (!first) return { ok: false, reason: 'internal' };
      const result = await api.get(searchPath(first));
      return result.ok ? { ok: true, items: [], skipped: 0 } : result;
    },
  };
}
