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
});
