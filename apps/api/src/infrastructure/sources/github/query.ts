import { GITHUB_QUERY_BASE, type GithubSearchConfig } from '@lead-hunter/contracts';

export interface GithubQuery {
  q: string;
  /** The language this query filters on; `null` for the one without. */
  language: string | null;
}

const quoteIfNeeded = (value: string): string => (/[\s,]/.test(value) ? `"${value}"` : value);

/**
 * S-19 D-3, D-4: one query per language, or one without when the list is empty. The qualifiers are
 * fixed and the values come from a validated config, so nothing can add a qualifier of its own.
 */
export function buildQueries(config: GithubSearchConfig): GithubQuery[] {
  const labels = `label:${config.labels.map(quoteIfNeeded).join(',')}`;
  const base = `${GITHUB_QUERY_BASE} ${labels}`;
  if (config.languages.length === 0) return [{ q: base, language: null }];
  return config.languages.map((language) => ({
    q: `${base} language:${quoteIfNeeded(language)}`,
    language,
  }));
}

/** Plan-review 6: 30 per page keeps a page with full bodies under the response size limit. */
export const SEARCH_PER_PAGE = 30;

export function searchPath({ q }: GithubQuery): string {
  const params = new URLSearchParams({
    q,
    sort: 'created',
    order: 'desc',
    per_page: String(SEARCH_PER_PAGE),
    page: '1',
  });
  return `/search/issues?${params.toString()}`;
}
