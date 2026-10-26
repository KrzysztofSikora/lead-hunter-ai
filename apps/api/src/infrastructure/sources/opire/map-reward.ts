import type { BountyFacts } from '@lead-hunter/contracts';
import { z } from 'zod';

const ISSUE_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/(?!\.{1,2}\/)([A-Za-z0-9._-]{1,100})\/issues\/(\d{1,10})$/;
const MAX_MINOR = 100_000_000_000;

const Reward = z
  .object({
    url: z.string(),
    pendingPrice: z
      .object({ value: z.number().optional(), unit: z.string().optional() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export interface OpireReward {
  owner: string;
  repo: string;
  issueNumber: number;
  /** The GitHub-side key, shared with the search adapter (S-19 D-6, D-12). */
  key: string;
  /** `null`: Opire gave no amount in a unit this code reads (D-7). */
  reward: NonNullable<BountyFacts['reward']> | null;
  /** The text line the signal carries for the reward (D-6). */
  line: string | null;
}

/** D-15: an array, or an object with an array under `rewards` or `data`; anything else is a shape change. */
export function rewardList(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (json !== null && typeof json === 'object') {
    const object = json as Record<string, unknown>;
    for (const field of ['rewards', 'data']) {
      const value = object[field];
      if (Array.isArray(value)) return value;
    }
  }
  return null;
}

/** D-7: only `USD_CENT` is read; any other unit is unknown, never a guessed amount. */
function amountOf(raw: z.infer<typeof Reward>): OpireReward['reward'] {
  const price = raw.pendingPrice;
  if (!price || price.unit !== 'USD_CENT') return null;
  const value = price.value;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_MINOR) {
    return null;
  }
  const whole = Math.floor(value / 100);
  const cents = String(value % 100).padStart(2, '0');
  return { amountMinor: value, currency: 'USD', quote: `Nagroda (Opire): ${whole}.${cents} USD` };
}

/** One Opire reward, or `'invalid'` when it names no GitHub issue we can read. */
export function mapReward(raw: unknown): OpireReward | 'invalid' {
  const parsed = Reward.safeParse(raw);
  if (!parsed.success) return 'invalid';
  const match = ISSUE_URL.exec(parsed.data.url);
  if (!match) return 'invalid';
  const [, owner, repo, number] = match as unknown as [string, string, string, string];
  const issueNumber = Number(number);
  if (`${owner}/${repo}`.length > 140 || issueNumber < 1 || issueNumber > 1_000_000_000) {
    return 'invalid';
  }
  const reward = amountOf(parsed.data);
  return {
    owner,
    repo,
    issueNumber,
    key: `github:${owner}/${repo}#${issueNumber}`,
    reward,
    line: reward?.quote ?? null,
  };
}
