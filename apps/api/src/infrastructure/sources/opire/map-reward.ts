import type { BountyFacts } from '@lead-hunter/contracts';
import { issueKey, parseIssueUrl, type IssueRef } from '../github/names.js';

/**
 * S-19 D-15: every Opire field is read in this file and nowhere else. The response shape is
 * `UNVERIFIED` (third-party description); a change is a one-file fix, never a silent "no results".
 */
export type OpireList = { ok: true; rewards: unknown[] } | { ok: false };

export function rewardList(json: unknown): OpireList {
  if (Array.isArray(json)) return { ok: true, rewards: json };
  if (typeof json === 'object' && json !== null) {
    const envelope = json as Record<string, unknown>;
    for (const name of ['rewards', 'data']) {
      if (Array.isArray(envelope[name])) return { ok: true, rewards: envelope[name] as unknown[] };
    }
  }
  return { ok: false };
}

export interface OpireReward {
  ref: IssueRef;
  key: string;
  /** `null` when the price is missing or in a unit this code does not know (never guessed). */
  reward: BountyFacts['reward'];
  /** The adapter's `Nagroda (Opire)` line, or `null` without a reward. */
  line: string | null;
}

const MAX_MINOR = 100_000_000_000;

/** `pendingPrice: { value, unit: 'USD_CENT' }` → integer cents; anything else → `null`. */
function price(raw: unknown): BountyFacts['reward'] {
  if (typeof raw !== 'object' || raw === null) return null;
  const { value, unit } = raw as Record<string, unknown>;
  if (unit !== 'USD_CENT') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_MINOR) {
    return null;
  }
  const major = `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
  return { amountMinor: value, currency: 'USD', quote: `${major} USD` };
}

/** `null` when the reward has no usable GitHub issue URL (counted as skipped). */
export function mapReward(raw: unknown): OpireReward | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const ref = parseIssueUrl(record.url);
  if (ref === null) return null;
  const reward = price(record.pendingPrice);
  return {
    ref,
    key: issueKey(ref),
    reward,
    line: reward === null ? null : `Nagroda (Opire): ${reward.quote}`,
  };
}
