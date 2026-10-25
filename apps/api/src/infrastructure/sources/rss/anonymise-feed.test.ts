import { describe, expect, it } from 'vitest';
import { anonymiseFeed } from './anonymise-feed.js';

describe('anonymiseFeed (lesson: bound untrusted input)', () => {
  it('replaces e-mail addresses', () => {
    const xml = '<rss><channel><item><title>DEMO jan@firma.pl</title></item></channel></rss>';
    expect(anonymiseFeed(xml)).toContain('demo@example.com');
  });

  it('scrubs a body of FETCH_MAX_BYTES made of one long token in under 2 s', () => {
    const xml = `<rss><channel><item><title>${'a'.repeat(1_048_576)}</title></item></channel></rss>`;
    const started = Date.now();
    anonymiseFeed(xml);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('replaces author bodies, including nested tags', () => {
    const xml =
      '<feed><entry><author><name>Jan Kowalski</name></author><title>DEMO</title></entry></feed>';
    const out = anonymiseFeed(xml);
    expect(out).toContain('<author>DEMO</author>');
    expect(out).not.toContain('Kowalski');
  });

  it.each([
    ['digit-dash runs', '(1-'.repeat(350_000)],
    ['unclosed author tags', '<author>'.repeat(131_000)],
    ['unclosed author tags with attributes', '<author x'.repeat(100_000)],
  ])('scrubs a FETCH_MAX_BYTES body of %s in under 2 s', (_name, body) => {
    const xml = `<rss><channel><item><title>${body}</title></item></channel></rss>`;
    const started = Date.now();
    anonymiseFeed(xml);
    anonymiseFeed(`<rss>${body}</rss>`);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
