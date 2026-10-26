import { describe, expect, it } from 'vitest';
import { buildTedQuery, TED_OPENING_TYPES } from './query.js';

const DAY = Date.parse('2026-10-20T00:00:00Z');

describe('buildTedQuery (S-18 D-19, D-25)', () => {
  it('builds the expert query for one UTC day from prefixes, alpha-3 countries and opening types', () => {
    expect(buildTedQuery({ cpvPrefixes: ['72', '48', '73'], countries: ['PL', 'DE'] }, DAY)).toBe(
      'classification-cpv IN (72* 48* 73*) AND buyer-country IN (POL DEU) AND ' +
        'notice-type IN (cn-standard cn-social cn-desg subco pin-cfc-standard pin-cfc-social) ' +
        'AND publication-date>=20261020 AND publication-date<=20261020',
    );
  });

  it('leaves out qu-sy, which is not a request for an offer', () => {
    expect(TED_OPENING_TYPES).not.toContain('qu-sy');
  });

  it('refuses a prefix or country that is not already validated, instead of quoting it', () => {
    expect(() => buildTedQuery({ cpvPrefixes: ['72) OR (1'], countries: ['PL'] }, DAY)).toThrow();
    expect(() => buildTedQuery({ cpvPrefixes: ['72'], countries: ['US'] }, DAY)).toThrow();
    expect(() => buildTedQuery({ cpvPrefixes: ['72'], countries: ['constructor'] }, DAY)).toThrow();
  });
});
