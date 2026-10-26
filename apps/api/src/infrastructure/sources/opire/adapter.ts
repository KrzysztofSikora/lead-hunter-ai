import { OpireConfig } from '@lead-hunter/contracts';
import type { Clock } from '../../../modules/shared/clock.js';
import type { AdapterOutcome, FeedItem, SourceAdapter } from '../../../modules/sources/ports.js';
import { HttpFetchError, type HttpClient } from '../http/client.js';
import { createGithubApi, type GithubApi } from '../github/api.js';
import { mapIssue } from '../github/map-issue.js';
import { mapReward, rewardList } from './map-reward.js';

export const OPIRE_REWARDS_URL = 'https://api.opire.dev/rewards';
/** D-8: GitHub core calls per run (60 an hour anonymous) and the gap between them. */
export const MAX_ISSUE_CHECKS = 20;
export const CHECK_SPACING_MS = 1_000;

export interface OpireAdapterDeps {
  http: HttpClient;
  clock: Clock;
  timeoutMs: number;
  maxAttempts: number;
  maxTextChars: number;
  token?: string | undefined;
  sleep?: (ms: number) => Promise<void>;
  logger?: { info(message: string): void; warn(message: string): void };
  api?: GithubApi;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * S-19 D-8, D-15: the public rewards list, then one GitHub call per new reward to learn whether its
 * issue is still open. The Opire request never carries the GitHub token (D-9).
 */
export function createOpireAdapter(deps: OpireAdapterDeps): SourceAdapter<OpireConfig> {
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

  async function fetchRewards(): Promise<
    { ok: true; list: unknown[] } | Extract<AdapterOutcome, { ok: false }>
  > {
    let response;
    try {
      response = await deps.http.get(OPIRE_REWARDS_URL, {
        signal: AbortSignal.timeout(deps.timeoutMs),
        accept: 'application/json',
      });
    } catch (error) {
      const failure = error instanceof HttpFetchError ? error : new HttpFetchError('network');
      return {
        ok: false,
        reason: failure.reason,
        ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
      };
    }
    if (response.status === 429) {
      return { ok: false, reason: 'rate_limited', httpStatus: 429 };
    }
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, reason: 'http_status', httpStatus: response.status };
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(response.body).toString('utf8'));
    } catch {
      return { ok: false, reason: 'invalid_feed' };
    }
    const list = rewardList(json);
    return list ? { ok: true, list } : { ok: false, reason: 'invalid_feed' };
  }

  async function discover(
    _config: OpireConfig,
    context: { seen: ReadonlySet<string> },
  ): Promise<AdapterOutcome> {
    const rewards = await fetchRewards();
    if (!rewards.ok) return rewards;

    const items: FeedItem[] = [];
    const checkedKeys: string[] = [];
    const queued = new Set<string>();
    let skipped = 0;
    let closed = 0;
    let missing = 0;
    let checks = 0;
    let truncated = false;

    for (const raw of rewards.list) {
      const reward = mapReward(raw);
      if (reward === 'invalid') {
        skipped += 1;
        continue;
      }
      if (context.seen.has(reward.key) || queued.has(reward.key)) continue;
      if (checks >= MAX_ISSUE_CHECKS) {
        truncated = true;
        break;
      }
      queued.add(reward.key);
      if (checks > 0) await sleep(CHECK_SPACING_MS);
      checks += 1;
      const issue = await api.get(
        `/repos/${reward.owner}/${reward.repo}/issues/${reward.issueNumber}`,
      );
      if (!issue.ok) {
        if (issue.reason === 'rate_limited') return issue;
        if (issue.httpStatus === 404 || issue.httpStatus === 410) {
          missing += 1;
          checkedKeys.push(reward.key);
        } else skipped += 1;
        continue;
      }
      checkedKeys.push(reward.key);
      const state = (issue.json as { state?: unknown } | null)?.state;
      if (state !== 'open') {
        closed += 1;
        continue;
      }
      const mapped = mapIssue(issue.json, {
        platform: 'opire',
        maxTextChars: deps.maxTextChars,
        reward: reward.reward,
        ...(reward.line ? { opireLine: reward.line } : {}),
      });
      if (mapped === 'pull_request') {
        continue;
      }
      if (mapped === 'invalid') {
        skipped += 1;
        continue;
      }
      items.push(mapped);
    }
    deps.logger?.info(`opire: closed ${closed} missing ${missing} checked ${checks}`);
    return {
      ok: true,
      items,
      skipped,
      ...(truncated ? { truncated: true as const } : {}),
      ...(checkedKeys.length > 0 ? { checkedKeys } : {}),
    };
  }

  return {
    type: 'opire',
    validateConfig(config) {
      const parsed = OpireConfig.safeParse(config);
      if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
      return { ok: true, config: parsed.data, key: 'opire' };
    },
    discover,
    async healthCheck() {
      const rewards = await fetchRewards();
      return rewards.ok ? { ok: true, items: [], skipped: 0 } : rewards;
    },
  };
}
