import { TED_COUNTRY_CODES } from '@lead-hunter/contracts';

/**
 * The notice types that open a procedure (eForms "competition", S-18 D-25). `qu-sy` (utilities
 * qualification systems) is left out: it is not a request for an offer.
 */
export const TED_OPENING_TYPES = [
  'cn-standard',
  'cn-social',
  'cn-desg',
  'subco',
  'pin-cfc-standard',
  'pin-cfc-social',
] as const;

const DAY_MS = 24 * 3_600_000;

/** `20261020`, the UTC day of an instant (`UNVERIFIED` date syntax of the expert query). */
const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');

/**
 * The expert query for one UTC-day slice (D-21). Every input is already validated (digits and
 * alpha-2 codes of the allow-list), so nothing from a source reaches the query; a value that is
 * not of that shape throws instead of being quoted.
 */
export function buildTedQuery(
  config: { cpvPrefixes: readonly string[]; countries: readonly string[] },
  dayStart: number,
): string {
  const prefixes = config.cpvPrefixes.map((prefix) => {
    if (!/^\d{2,8}$/.test(prefix)) throw new Error('invalid CPV prefix');
    return `${prefix}*`;
  });
  const countries = config.countries.map((code) => {
    const alpha3 = Object.hasOwn(TED_COUNTRY_CODES, code) ? TED_COUNTRY_CODES[code] : undefined;
    if (alpha3 === undefined) throw new Error('invalid country');
    return alpha3;
  });
  const day = ymd(dayStart);
  return [
    `classification-cpv IN (${prefixes.join(' ')})`,
    `buyer-country IN (${countries.join(' ')})`,
    `notice-type IN (${TED_OPENING_TYPES.join(' ')})`,
    `publication-date>=${day}`,
    `publication-date<=${ymd(dayStart + DAY_MS - 1)}`,
  ].join(' AND ');
}
