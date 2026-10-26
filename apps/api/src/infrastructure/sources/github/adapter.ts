import { GithubSearchConfig } from '@lead-hunter/contracts';
import type { AdapterOutcome, FeedItem, SourceAdapter } from '../../../modules/sources/ports.js';
import type { GithubApi } from './api.js';
import { mapIssue } from './map-issue.js';
import { buildQueries, type GithubQuery } from './query.js';

export const GITHUB_PAGE_SIZE = 30;

export interface GithubAdapterDeps {
  api: GithubApi;
  maxTextChars: number;
  /** Counts and reasons only, never issue text or query text (FR-24 AC2). */
  logger?: { info(message: string): void; warn(message: string): void };
}

type Search =
  { ok: true; items: unknown[]; incomplete: boolean } | Extract<AdapterOutcome, { ok: false }>;

/**
 * The GitHub issue search (S-19 D-1, D-4, D-5, D-17). It ignores `since` and `resumeAt`: every run
 * asks for the most recently updated issues, and the cursor and the identity dedupe absorb repeats.
 */
export function createGithubAdapter({
  api,
  maxTextChars,
  logger,
}: GithubAdapterDeps): SourceAdapter<GithubSearchConfig> {
  async function search(query: GithubQuery, perPage: number): Promise<Search> {
    const path =
      `/search/issues?q=${encodeURIComponent(query.q)}` +
      `&sort=updated&order=desc&per_page=${perPage}`;
    const result = await api.get(path);
    if (!result.ok) return result;
    const body = result.json as { items?: unknown; incomplete_results?: unknown } | null;
    if (typeof body !== 'object' || body === null || !Array.isArray(body.items)) {
      return { ok: false, reason: 'invalid_feed' };
    }
    return { ok: true, items: body.items, incomplete: body.incomplete_results === true };
  }

  async function discover(config: GithubSearchConfig): Promise<AdapterOutcome> {
    const queries = buildQueries(config);
    const items: FeedItem[] = [];
    const keys = new Set<string>();
    let skipped = 0;
    let ignored = 0;
    let requests = 0;
    let failed = false;
    for (const [index, query] of queries.entries()) {
      requests += 1;
      const result = await search(query, GITHUB_PAGE_SIZE);
      if (!result.ok) {
        // D-17: before the first success the run fails; afterwards what was found is kept.
        if (index === 0) return result;
        logger?.warn(
          `github search: query ${index + 1} failed ${result.reason}${
            result.httpStatus === undefined ? '' : ` ${result.httpStatus}`
          }`,
        );
        failed = true;
        break;
      }
      if (result.incomplete) logger?.info(`github search: query ${index + 1} incomplete_results`);
      for (const raw of result.items) {
        const mapped = mapIssue(raw, query.language, maxTextChars);
        if (mapped.kind === 'ignored') ignored += 1;
        else if (mapped.kind === 'invalid') skipped += 1;
        else if (mapped.item.key !== null && !keys.has(mapped.item.key)) {
          keys.add(mapped.item.key);
          items.push(mapped.item);
        }
      }
    }
    logger?.info(`github: requests ${requests} of ${queries.length}; pull requests ${ignored}`);
    return failed ? { ok: true, items, skipped, truncated: true } : { ok: true, items, skipped };
  }

  return {
    type: 'github',
    validateConfig(config) {
      const parsed = GithubSearchConfig.safeParse(config);
      if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
      return { ok: true, config: parsed.data, key: 'github' };
    },
    discover: (config) => discover(config),
    async healthCheck(config) {
      const [query] = buildQueries(config);
      const result = await search(query!, 1);
      if (!result.ok) return result;
      const items = result.items.flatMap((raw) => {
        const mapped = mapIssue(raw, query!.language, maxTextChars);
        return mapped.kind === 'item' ? [mapped.item] : [];
      });
      return { ok: true, items, skipped: 0 };
    },
  };
}
