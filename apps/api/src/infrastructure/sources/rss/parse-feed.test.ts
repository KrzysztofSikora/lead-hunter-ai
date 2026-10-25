import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES, parseFeed } from './parse-feed.js';

const DIR = new URL('../../../../test/fixtures/feeds/', import.meta.url);
const bytes = (text: string) => new TextEncoder().encode(text);
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(name, DIR)));
const parse = (name: string, url: string, max = 20_000) => {
  const parsed = parseFeed(fixture(name), url, max);
  if (parsed === 'invalid_feed') throw new Error(`${name} did not parse`);
  return parsed;
};

describe('parseFeed (S-10 D-12, D-13, TR-17)', () => {
  it('maps a hnrss item: key, link, date, text from CDATA HTML, title from the comment', () => {
    const { items, skipped } = parse(
      'synthetic-hnrss-freelance.xml',
      'https://hnrss.org/whoishiring/freelance',
    );
    expect(skipped).toBe(0);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      key: 'https://news.ycombinator.com/item?id=900000001',
      url: 'https://news.ycombinator.com/item?id=900000001',
      title: 'SEEKING FREELANCER | DEMO Logistics | Remote',
      publishedAt: Date.parse('2026-10-05T09:30:00Z'),
    });
    expect(items[0]?.text).toContain('Budget & timeline negotiable.');
    expect(items[0]?.text).not.toMatch(/<\/?p>/);
    expect(items[0]?.text.split('\n')).toContain(
      'We need a contractor for a route planning dashboard (TypeScript, Node.js). Budget & timeline negotiable.',
    );
  });

  it('decodes escaped HTML in description', () => {
    const { items } = parse('synthetic-hnrss-freelance.xml', 'https://hnrss.org/x');
    expect(items[1]?.text).toBe(
      'SEEKING WORK | DEMO-user-2 | Remote\nFull-stack developer, 10 years of experience.',
    );
  });

  it('keeps the feed title when the host is not hnrss', () => {
    const { items } = parse('synthetic-hnrss-freelance.xml', 'https://feeds.example.com/x');
    expect(items[0]?.title).toMatch(/^New comment by DEMO-user-1/);
  });

  it('maps a WWR item and decodes entities once', () => {
    const { items } = parse(
      'synthetic-wwr-programming.xml',
      'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    );
    expect(items[0]).toMatchObject({
      title: 'DEMO Studio: Senior Back-End Developer (Node.js)',
      url: 'https://weworkremotely.com/remote-jobs/demo-studio-senior-back-end-developer',
    });
    expect(items[0]?.text).toContain('About the role');
    expect(items[0]?.text).toContain('Node.js\nPostgreSQL');
    expect(items[1]?.title).toBe('DEMO Shop & Co: Full-Stack Engineer');
    expect(items[1]?.text).toBe('Build a storefront admin panel in React & TypeScript.');
  });

  it('maps Atom entries: alternate link, published else updated, relative link resolved', () => {
    const { items } = parse('synthetic-atom.xml', 'https://feeds.example.com/atom.xml');
    expect(items[0]).toMatchObject({
      key: 'tag:example.com,2026:demo-1',
      url: 'https://example.com/zlecenia/1',
      publishedAt: Date.parse('2026-10-07T08:00:00Z'),
      text: 'Potrzebny skrypt generujący raporty z CSV.',
    });
    expect(items[1]).toMatchObject({
      url: 'https://feeds.example.com/zlecenia/2',
      publishedAt: Date.parse('2026-10-07T09:30:00Z'),
      text: 'Tekst zwykły & prosty.',
    });
  });

  it('handles edge cases: no date, bad date, CDATA is not decoded twice, bad scheme, empty entry', () => {
    const { items, skipped } = parse('synthetic-edge.xml', 'https://feeds.example.com/rss');
    expect(skipped).toBe(1);
    expect(items[0]).toMatchObject({
      key: 'demo-edge-1',
      url: 'https://feeds.example.com/jobs/relative-1',
      publishedAt: null,
    });
    expect(items[1]?.publishedAt).toBeNull();
    expect(items[1]?.text).toBe('Fish &amp; chips <b>literal</b> real');
    expect(items[2]).toMatchObject({ title: '12345', url: null, key: 'demo-edge-3' });
    expect(items[2]?.text).toBe('Numeric title – kept as text here.');
  });

  it('never keeps tags, scripts as tags or non-http links', () => {
    const { items } = parse('synthetic-edge.xml', 'https://feeds.example.com/rss');
    for (const item of items) {
      expect(item.text).not.toMatch(/<(p|script|i)\b/);
      expect(item.url === null || /^https?:/.test(item.url)).toBe(true);
    }
  });

  it('reports malformed XML and other documents as invalid_feed', () => {
    expect(parseFeed(fixture('synthetic-invalid.xml'), 'https://example.com/f', 1000)).toBe(
      'invalid_feed',
    );
    expect(parseFeed(bytes('<html><body>x</body></html>'), 'https://example.com/f', 1000)).toBe(
      'invalid_feed',
    );
    expect(parseFeed(bytes(''), 'https://example.com/f', 1000)).toBe('invalid_feed');
  });

  it('accepts a channel without items', () => {
    const empty = '<rss version="2.0"><channel><title>x</title></channel></rss>';
    expect(parseFeed(bytes(empty), 'https://example.com/f', 1000)).toEqual({
      items: [],
      skipped: 0,
    });
  });

  it('does not expand DOCTYPE entities', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;">]>
      <rss version="2.0"><channel><item><title>&b;</title><link>https://example.com/x</link></item></channel></rss>`;
    const parsed = parseFeed(bytes(xml), 'https://example.com/f', 1000);
    if (parsed === 'invalid_feed') return;
    expect(parsed.items[0]?.title).not.toContain('AAAA');
  });

  it(`reads at most ${MAX_ENTRIES} entries and cuts the text`, () => {
    const item = (n: number) =>
      `<item><title>DEMO ${n}</title><link>https://example.com/${n}</link><description>${'x'.repeat(500)}</description></item>`;
    const xml = `<rss version="2.0"><channel>${Array.from({ length: 250 }, (_, n) => item(n)).join('')}</channel></rss>`;
    const parsed = parseFeed(bytes(xml), 'https://example.com/f', 100);
    if (parsed === 'invalid_feed') throw new Error('invalid');
    expect(parsed.items).toHaveLength(MAX_ENTRIES);
    expect(parsed.items[0]?.text).toHaveLength(100);
  });

  it('parses a feed of FETCH_MAX_BYTES in under 2 s (lesson: bound untrusted input)', () => {
    const nested = '<b>'.repeat(5000) + 'DEMO' + '</b>'.repeat(5000);
    const entry = `<item><title>DEMO</title><link>https://example.com/1</link><description><![CDATA[${nested}&amp;&lt;]]></description></item>`;
    const head = '<rss version="2.0"><channel>';
    const tail = '</channel></rss>';
    const limit = 1_048_576;
    const body =
      head + entry.repeat(Math.floor((limit - head.length - tail.length) / entry.length)) + tail;
    expect(body.length).toBeLessThanOrEqual(limit);
    const started = performance.now();
    const parsed = parseFeed(bytes(body), 'https://example.com/f', 20_000);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(parsed).not.toBe('invalid_feed');
  });

  const recorded = readdirSync(DIR).filter(
    (f) => f.endsWith('.xml') && !f.startsWith('synthetic-'),
  );
  it.each(recorded)('recorded fixture %s yields at least one valid signal (D-14)', (name) => {
    const { items } = parse(name, 'https://feeds.example.com/recorded');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.url ?? item.text).toBeTruthy();
  });
});
