import { OpireConfig, type BountyFacts } from '@lead-hunter/contracts';
import type { AdapterOutcome, FeedItem, SourceAdapter } from '../../../modules/sources/ports.js';
import type { GithubApi } from '../github/api.js';
import { mapIssue } from '../github/map-issue.js';
import { mapReward, rewardList } from './map-reward.js';

/** S-19 D-8: GitHub checks per run; the rest wait for the next one. */
export const OPIRE_MAX_CHECKS = 20;

export interface OpireAdapterDeps {
  github: GithubApi;
  /** Opire's list, a plain GET of its public endpoint; it never carries the GitHub token (D-9). */
  fetchList: () => Promise<{ ok: true; json: unknown } | Extract<AdapterOutcome, { ok: false }>>;
  maxTextChars: number;
  /** Counts and reasons only (FR-24 AC2). */
  logger?: { info(message: string): void; warn(message: string): void };
}

/**
 * The Opire rewards (S-19 D-1, D-8, D-15). Opire does not say whether an issue is closed, so each
 * new reward is checked on GitHub; only an open issue becomes a signal. It ignores `since`.
 */
export function createOpireAdapter({
  github,
  fetchList,
  maxTextChars,
  logger,
}: OpireAdapterDeps): SourceAdapter<OpireConfig> {
  async function list(): Promise<
    { ok: true; rewards: unknown[] } | Extract<AdapterOutcome, { ok: false }>
  > {
    const result = await fetchList();
    if (!result.ok) return result;
    const parsed = rewardList(result.json);
    return parsed.ok ? parsed : { ok: false, reason: 'invalid_feed' };
  }

  return {
    type: 'opire',
    validateConfig(config) {
      const parsed = OpireConfig.safeParse(config);
      if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
      return { ok: true, config: parsed.data, key: 'opire' };
    },
    async discover(_config, { seen }) {
      const fetched = await list();
      if (!fetched.ok) return fetched;
      const items: FeedItem[] = [];
      const checkedKeys: string[] = [];
      const keys = new Set<string>();
      let skipped = 0;
      let closed = 0;
      let missing = 0;
      let checks = 0;
      let truncated = false;
      for (const raw of fetched.rewards) {
        const reward = mapReward(raw);
        if (reward === null) {
          skipped += 1;
          continue;
        }
        if (seen.has(reward.key) || keys.has(reward.key)) continue;
        keys.add(reward.key);
        if (checks >= OPIRE_MAX_CHECKS) {
          truncated = true;
          break;
        }
        checks += 1;
        const { owner, repo, number } = reward.ref;
        const issue = await github.get(`/repos/${owner}/${repo}/issues/${number}`);
        if (!issue.ok) {
          // A limit stops the run; any other failed check is retried next time (not remembered).
          if (issue.reason === 'rate_limited') return issue;
          if (issue.httpStatus === 404 || issue.httpStatus === 410) {
            missing += 1;
            checkedKeys.push(reward.key);
          } else skipped += 1;
          continue;
        }
        // The reward's own key is remembered even if the answer names another issue (v1 R5).
        checkedKeys.push(reward.key);
        const object = issue.json as Record<string, unknown> | null;
        if (typeof object !== 'object' || object === null) {
          skipped += 1;
          continue;
        }
        if (object.state !== 'open') {
          closed += 1;
          continue;
        }
        const mapped = mapIssue(object, null, maxTextChars);
        if (mapped.kind === 'ignored') {
          closed += 1;
          continue;
        }
        const item = mapped.kind === 'item' ? mapped.item : null;
        if (item === null || item.bounty === undefined) {
          skipped += 1;
          continue;
        }
        // The issue the answer names (a transferred one differs from the reward's URL) is the signal.
        const bounty: BountyFacts = { ...item.bounty, platform: 'opire', reward: reward.reward };
        const header = item.text.indexOf('\n\n');
        const head = header === -1 ? item.text : item.text.slice(0, header);
        const body = header === -1 ? '' : item.text.slice(header);
        items.push({
          ...item,
          text: `${head}${reward.line === null ? '' : `\n${reward.line}`}${body}`,
          bounty,
        });
      }
      logger?.info(
        `opire: rewards ${fetched.rewards.length} checked ${checks} closed ${closed} missing ${missing}`,
      );
      return {
        ok: true,
        items,
        skipped,
        checkedKeys,
        ...(truncated ? { truncated: true as const } : {}),
      };
    },
    async healthCheck() {
      const fetched = await list();
      if (!fetched.ok) return fetched;
      return { ok: true, items: [], skipped: 0 };
    },
  };
}
