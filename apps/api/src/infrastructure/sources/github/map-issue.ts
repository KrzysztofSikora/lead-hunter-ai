import type { BountyFacts } from '@lead-hunter/contracts';
import type { FeedItem } from '../../../modules/sources/ports.js';
import { issueKey, issueUrl, parseIssueUrl } from './names.js';
import { parseReward } from './reward.js';

const TITLE_MAX = 300;
const LABEL_MAX = 50;
const LABELS_MAX = 20;
const DATE_MIN = Date.UTC(2000, 0, 1);
const DATE_MAX = Date.UTC(2100, 0, 1);

export type MappedIssue =
  | { kind: 'item'; item: FeedItem }
  /** A pull request that the issue search returned; not a request for work. */
  | { kind: 'ignored' }
  /** Cannot be read; the run counts it as skipped (partial). */
  | { kind: 'invalid' };

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
};

/** D-16: the creation day as `YYYY-MM-DD`, or `null` outside 2000…2100 or when unreadable. */
function creationDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  if (Number.isNaN(at) || at < DATE_MIN || at >= DATE_MAX) return null;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Every field of a GitHub issue is read here and nowhere else. `language` is the one the search
 * was limited to (D-6). The reward comes from the parser over the cut text, never from a model.
 */
export function mapIssue(raw: unknown, language: string | null, maxTextChars: number): MappedIssue {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'invalid' };
  const issue = raw as Record<string, unknown>;
  if (issue.pull_request !== undefined && issue.pull_request !== null) return { kind: 'ignored' };

  const ref = parseIssueUrl(issue.html_url);
  const title = text(issue.title, TITLE_MAX);
  if (ref === null || title === null) return { kind: 'invalid' };

  const labels = (Array.isArray(issue.labels) ? issue.labels : [])
    .map((label: unknown) =>
      typeof label === 'object' && label !== null
        ? text((label as Record<string, unknown>).name, LABEL_MAX)
        : null,
    )
    .filter((name): name is string => name !== null)
    .slice(0, LABELS_MAX);
  const body = typeof issue.body === 'string' ? issue.body.slice(0, maxTextChars) : '';

  const reward = parseReward({ labels, title, body });
  const bounty: BountyFacts = {
    platform: 'github',
    repository: `${ref.owner}/${ref.repo}`,
    issueNumber: ref.number,
    labels,
    reward,
  };
  const created = creationDay(issue.created_at);
  const lines = [
    title,
    `Repozytorium: ${bounty.repository}`,
    ...(labels.length > 0 ? [`Etykiety: ${labels.join(', ')}`] : []),
    ...(language === null ? [] : [`Język (wyszukiwanie): ${language}`]),
    ...(created === null ? [] : [`Utworzono: ${created}`]),
  ];
  return {
    kind: 'item',
    item: {
      key: issueKey(ref),
      url: issueUrl(ref),
      title,
      text: `${lines.join('\n')}\n\n${body}`.trimEnd(),
      publishedAt: null,
      bounty,
    },
  };
}
