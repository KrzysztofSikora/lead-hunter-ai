import { GITHUB_QUERY_BASE, type GithubSearchConfig } from '@lead-hunter/contracts';

export interface GithubQuery {
  /** The `q` parameter. */
  q: string;
  /** The language the query is limited to; `null` when the config lists none. */
  language: string | null;
}

/** The same quoting as `longestGithubQuery`, so the contract refine and the adapter agree. */
const quoteLabel = (label: string): string => (/[\s,]/.test(label) ? `"${label}"` : label);

/**
 * S-19 D-3, D-4: one query per language, or one without a language when the list is empty. The
 * config is validated before it is stored (no `"` in a label, languages from a fixed list), so
 * nothing here needs escaping.
 */
export function buildQueries(config: GithubSearchConfig): GithubQuery[] {
  const labels = `label:${config.labels.map(quoteLabel).join(',')}`;
  const base = `${GITHUB_QUERY_BASE} ${labels}`;
  if (config.languages.length === 0) return [{ q: base, language: null }];
  return config.languages.map((language) => ({
    q: `${base} language:"${language}"`,
    language,
  }));
}
