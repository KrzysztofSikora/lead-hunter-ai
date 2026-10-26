import { GITHUB_OWNER_PATTERN, GITHUB_REPO_PATTERN } from '@lead-hunter/contracts';

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

/** S-19 D-2, v1 R4: a name is checked before it reaches a path or a stored key. */
export function validNames(owner: string, repo: string): boolean {
  return (
    GITHUB_OWNER_PATTERN.test(owner) &&
    GITHUB_REPO_PATTERN.test(repo) &&
    repo !== '.' &&
    repo !== '..'
  );
}

/** `https://github.com/<owner>/<repo>/issues/<n>` and nothing else (no query, no fragment). */
export function parseIssueUrl(value: unknown): IssueRef | null {
  if (typeof value !== 'string') return null;
  const match = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/issues\/(\d{1,10})$/.exec(value);
  if (!match) return null;
  const [, owner, repo, digits] = match;
  const number = Number(digits);
  if (!validNames(owner!, repo!) || number < 1 || number > 1_000_000_000) return null;
  return { owner: owner!, repo: repo!, number };
}

/** S-19 D-6: one key form for both bounty types, so the same issue is one record (D-12). */
export const issueKey = ({ owner, repo, number }: IssueRef): string =>
  `github:${owner}/${repo}#${number}`;

export const issueUrl = ({ owner, repo, number }: IssueRef): string =>
  `https://github.com/${owner}/${repo}/issues/${number}`;
