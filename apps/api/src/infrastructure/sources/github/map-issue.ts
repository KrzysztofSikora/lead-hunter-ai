import type { BountyFacts } from '@lead-hunter/contracts';
import { z } from 'zod';
import type { FeedItem } from '../../../modules/sources/ports.js';
import { parseReward } from './reward.js';

const ISSUE_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/(?!\.{1,2}\/)([A-Za-z0-9._-]{1,100})\/issues\/(\d{1,10})$/;

const Label = z.union([z.string(), z.object({ name: z.string() }).passthrough()]);
const Issue = z
  .object({
    html_url: z.string(),
    title: z.string(),
    body: z.string().nullish(),
    labels: z.array(Label).nullish(),
    pull_request: z.unknown().optional(),
    created_at: z.string().nullish(),
  })
  .passthrough();

export type MappedIssue = FeedItem | 'pull_request' | 'invalid';

export interface MapContext {
  /** The language of the query that found the issue (GitHub search only). */
  language?: string | null;
  /** Opire: the reward line the adapter writes (D-6). */
  opireLine?: string;
  /** Opire: the reward Opire states, which replaces what the text says (D-7). */
  reward?: BountyFacts['reward'];
  platform: BountyFacts['platform'];
  maxTextChars: number;
}

const CREATED_MIN = Date.UTC(2000, 0, 1);
const CREATED_MAX = Date.UTC(2100, 0, 1);

/** The issue's creation date as UTC ms, or `null` outside the range the contract can serialise. */
export function boundedDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && at >= CREATED_MIN && at < CREATED_MAX ? at : null;
}

/**
 * S-19 D-6: one search item or issue becomes a signal. The text is labelled lines (facts as data),
 * then the body cut to the limit. `publishedAt` stays `null`: an open bounty does not go stale with
 * the issue's age, so the pre-filter's `too_old` must not apply; the creation date is a text line.
 */
export function mapIssue(raw: unknown, context: MapContext): MappedIssue {
  const parsed = Issue.safeParse(raw);
  if (!parsed.success) return 'invalid';
  const issue = parsed.data;
  if (issue.pull_request !== undefined && issue.pull_request !== null) return 'pull_request';
  const match = ISSUE_URL.exec(issue.html_url);
  if (!match) return 'invalid';
  const [, owner, repo, number] = match as unknown as [string, string, string, string];
  const repository = `${owner}/${repo}`;
  const issueNumber = Number(number);
  if (repository.length > 140 || issueNumber < 1 || issueNumber > 1_000_000_000) return 'invalid';

  const labels = (issue.labels ?? [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter((name) => name.length > 0);
  const body = (issue.body ?? '').slice(0, context.maxTextChars);
  const created = boundedDate(issue.created_at);

  const lines = [issue.title, `Repozytorium: ${repository}`];
  if (labels.length > 0) lines.push(`Etykiety: ${labels.join(', ')}`);
  if (created !== null) lines.push(`Utworzono: ${new Date(created).toISOString().slice(0, 10)}`);
  if (context.language) lines.push(`Język (wyszukiwanie): ${context.language}`);
  if (context.opireLine) lines.push(context.opireLine);

  const reward =
    context.reward !== undefined
      ? context.reward
      : parseReward({ labels, title: issue.title, body });
  return {
    key: `github:${repository}#${issueNumber}`,
    url: issue.html_url,
    title: issue.title,
    text: `${lines.join('\n')}\n\n${body}`.trimEnd(),
    publishedAt: null,
    bounty: {
      platform: context.platform,
      repository,
      issueNumber,
      labels: labels.filter((name) => name.length <= 50).slice(0, 20),
      reward,
    },
  };
}
