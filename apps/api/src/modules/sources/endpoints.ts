import type { SourceKind } from '@lead-hunter/contracts';

/**
 * S-19 D-1: the fixed endpoint of every API source. The adapters call it, the presets and the
 * Sources view show it and the log names its host, so a correction is made here only (R6).
 */
export const BZP_ENDPOINT = 'https://ezamowienia.gov.pl/mo-board/api/v1/notice';
export const TED_ENDPOINT = 'https://api.ted.europa.eu/v3/notices/search';
export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const GITHUB_SEARCH_PATH = '/search/issues';
export const OPIRE_REWARDS_URL = 'https://api.opire.dev/rewards';

export const SOURCE_ENDPOINTS: Readonly<Record<Exclude<SourceKind, 'rss'>, string>> = {
  bzp: BZP_ENDPOINT,
  ted: TED_ENDPOINT,
  github: `${GITHUB_API_ORIGIN}${GITHUB_SEARCH_PATH}`,
  opire: OPIRE_REWARDS_URL,
};
