import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  contentHash,
  deriveTitle,
  InvalidUrlError,
  isNewEvidence,
  normaliseSnippet,
} from './identity.js';

describe('canonicalizeUrl (D-2)', () => {
  it.each([
    ['scheme and host case', 'HTTPS://Example.COM/Job', 'https://example.com/Job'],
    ['fragment', 'https://example.com/job#top', 'https://example.com/job'],
    ['default https port', 'https://example.com:443/job', 'https://example.com/job'],
    ['default http port', 'http://example.com:80/job', 'http://example.com/job'],
    ['non-default port is kept', 'https://example.com:8443/job', 'https://example.com:8443/job'],
    ['trailing slash', 'https://example.com/job/', 'https://example.com/job'],
    ['root path', 'https://example.com', 'https://example.com/'],
    ['root path with slash', 'https://example.com/', 'https://example.com/'],
    ['utm_*', 'https://example.com/job?utm_source=x&utm_medium=y', 'https://example.com/job'],
    [
      'fbclid, gclid, ref',
      'https://example.com/job?fbclid=1&gclid=2&ref=3',
      'https://example.com/job',
    ],
    [
      'parameter names in any case',
      'https://example.com/job?UTM_Source=x&Ref=1',
      'https://example.com/job',
    ],
    [
      'a non-tracking parameter is kept',
      'https://example.com/job?id=7&utm_source=x',
      'https://example.com/job?id=7',
    ],
    [
      'parameter order is kept',
      'https://example.com/job?b=2&a=1',
      'https://example.com/job?b=2&a=1',
    ],
    [
      'kept parameters stay byte-identical',
      'https://example.com/job?q=a%20b&x=1,2&utm_source=z',
      'https://example.com/job?q=a%20b&x=1,2',
    ],
    [
      'encoded and raw non-ASCII are one identity',
      'https://example.com/j?q=ą',
      'https://example.com/j?q=%C4%85',
    ],
    ['an empty query loses ?', 'https://example.com/job?', 'https://example.com/job'],
    ['IDN host', 'https://zażółć.pl/oferta', 'https://xn--za-6ja4f8n1l.pl/oferta'],
    [
      'everything at once',
      'HTTPS://Example.com:443/job/?utm_source=x#top',
      'https://example.com/job',
    ],
  ])('%s', (_name, input, expected) => {
    expect(canonicalizeUrl(input)).toBe(expected);
  });

  it('gives one identity for the variants of the same URL', () => {
    const base = canonicalizeUrl('https://example.com/job');
    for (const variant of [
      'https://example.com/job/',
      'https://EXAMPLE.com:443/job#x',
      'https://example.com/job?ref=a',
    ]) {
      expect(canonicalizeUrl(variant)).toBe(base);
    }
  });

  it.each([
    ['non-http scheme', 'ftp://example.com/job'],
    ['user info', 'https://user:pass@example.com/job'],
    ['unparsable', 'nie-adres'],
  ])('rejects %s as an invariant guard', (_name, input) => {
    expect(() => canonicalizeUrl(input)).toThrow(InvalidUrlError);
  });
});

describe('contentHash (D-2)', () => {
  it('is equal across whitespace, case and NFKC variants', () => {
    const base = contentHash('Szukam wykonawcy aplikacji React');
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash('  szukam   WYKONAWCY\r\naplikacji\treact  ')).toBe(base);
    expect(contentHash('Szukam wykonawcy aplikacji Ｒeact')).toBe(base);
  });

  it('differs for different words', () => {
    expect(contentHash('Szukam wykonawcy aplikacji React')).not.toBe(
      contentHash('Szukam wykonawcy aplikacji Vue'),
    );
  });

  it.each(['', '   ', '\n\t '])('is null for %j', (text) => {
    expect(contentHash(text)).toBeNull();
  });
});

describe('isNewEvidence (D-1)', () => {
  const existing = [{ canonicalUrl: 'https://a.pl/x', contentHash: 'h1' }];

  it.each([
    ['a known URL alone', { canonicalUrl: 'https://a.pl/x', contentHash: null }, false],
    ['a known text alone', { canonicalUrl: null, contentHash: 'h1' }, false],
    ['a known URL and text', { canonicalUrl: 'https://a.pl/x', contentHash: 'h1' }, false],
    ['a new URL', { canonicalUrl: 'https://b.pl/x', contentHash: null }, true],
    ['a new text', { canonicalUrl: null, contentHash: 'h2' }, true],
    ['a known URL with a new text', { canonicalUrl: 'https://a.pl/x', contentHash: 'h2' }, true],
    ['nothing', { canonicalUrl: null, contentHash: null }, false],
  ])('%s', (_name, candidate, expected) => {
    expect(isNewEvidence(existing, candidate)).toBe(expected);
  });
});

describe('deriveTitle and normaliseSnippet (D-7)', () => {
  it('uses the first non-blank line, cut to 200 characters', () => {
    expect(deriveTitle('\n  \n Szukam React \nreszta', null)).toBe('Szukam React');
    expect(deriveTitle('x'.repeat(250), null)).toHaveLength(200);
  });

  it('falls back to the URL as pasted, not the canonical form', () => {
    expect(deriveTitle('  ', 'https://example.com/job?utm_source=x#top')).toBe(
      'https://example.com/job?utm_source=x#top',
    );
  });

  it('trims the snippet and turns CRLF into LF', () => {
    expect(normaliseSnippet('  a\r\nb\r\n')).toBe('a\nb');
    expect(normaliseSnippet('   ')).toBe('');
  });
});
