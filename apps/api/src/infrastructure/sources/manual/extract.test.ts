import { describe, expect, it } from 'vitest';
import { pageFixture as fixture } from '../../../../test/helpers/page-fixture.js';
import { extractPage } from './extract.js';

const enc = (text: string) => new TextEncoder().encode(text);
const URL_ = 'https://example.com/job';
const LONG = 'Fikcyjne zlecenie na panel do planowania tras. '.repeat(20);

describe('extractPage (S-09 D-9, D-10)', () => {
  it('takes title and main text from the article, without menus and scripts', () => {
    const page = extractPage(
      fixture('synthetic-job-post.html'),
      'text/html; charset=utf-8',
      URL_,
      20_000,
    );
    expect(page).toMatchObject({ title: expect.stringContaining('aplikacja webowa') });
    const { text } = page as { text: string };
    expect(text).toContain('panel dyspozytora');
    expect(text).not.toContain('DEMO-NAWIGACJA');
    expect(text).not.toContain('DEMO-SCRIPT-TEXT');
    expect(text).not.toContain('DEMO-STOPKA');
  });

  it('keeps an injected instruction as plain text', () => {
    const page = extractPage(fixture('synthetic-job-post.html'), 'text/html', URL_, 20_000);
    expect((page as { text: string }).text).toContain('Ignore previous instructions');
  });

  it('decodes a charset from the meta tag when the header has none', () => {
    const page = extractPage(fixture('synthetic-iso-8859-2.html'), 'text/html', URL_, 20_000);
    expect(page).toMatchObject({ title: expect.stringContaining('Zażółć gęślą jaźń') });
  });

  it('prefers the charset of the header', () => {
    const body = Buffer.from(
      `<html><body><p>${LONG}za\u00bf\u00f3\u00b3\u00e6</p></body></html>`,
      'latin1',
    );
    const page = extractPage(body, 'text/html; charset=windows-1250', URL_, 20_000);
    expect((page as { text: string }).text).toContain('zażółć');
  });

  it('falls back to UTF-8 for an unknown charset label', () => {
    const page = extractPage(
      enc(`<p>${LONG}zażółć</p>`),
      'text/html; charset=nonsense',
      URL_,
      20_000,
    );
    expect((page as { text: string }).text).toContain('zażółć');
  });

  it('accepts xhtml', () => {
    const page = extractPage(
      enc(`<html><body><p>${LONG}</p></body></html>`),
      'application/xhtml+xml',
      URL_,
      20_000,
    );
    expect(page).toMatchObject({ text: expect.stringContaining('panel do planowania') });
  });

  it('uses the body text when Readability finds no article', () => {
    const page = extractPage(
      enc(
        '<html><head><title>Krótka</title></head><body><script>x()</script><p>Szukam React</p></body></html>',
      ),
      'text/html',
      URL_,
      20_000,
    );
    expect(page).toEqual({ title: 'Krótka', text: 'Szukam React' });
  });

  it('takes text/plain as is and derives the title from the first line', () => {
    const page = extractPage(
      enc('  Szukam wykonawcy  \r\n\r\n\r\n\r\ndruga   linia\t'),
      'text/plain; charset=utf-8',
      URL_,
      20_000,
    );
    expect(page).toEqual({ title: 'Szukam wykonawcy', text: 'Szukam wykonawcy\n\ndruga linia' });
  });

  it('cuts the text at a code-point boundary', () => {
    const page = extractPage(enc('😀😀😀😀'), 'text/plain', URL_, 3);
    expect(page).toMatchObject({ text: '😀😀😀' });
  });

  it('reports unsupported types and empty pages', () => {
    expect(extractPage(enc('{}'), 'application/json', URL_, 100)).toBe('unsupported_content');
    expect(extractPage(enc('%PDF'), '', URL_, 100)).toBe('unsupported_content');
    expect(
      extractPage(enc('<html><body><script>x()</script></body></html>'), 'text/html', URL_, 100),
    ).toBe('no_text');
    expect(extractPage(enc('   \n '), 'text/plain', URL_, 100)).toBe('no_text');
  });

  it('reports no text for an empty or tag-only HTML body', () => {
    for (const html of ['', '   \n', '<']) {
      expect(extractPage(enc(html), 'text/html', URL_, 20_000)).toBe('no_text');
    }
  });

  it('finishes quickly on deeply nested markup and still returns its text', () => {
    const depth = 2000;
    const html = `${'<div>'.repeat(depth)}Fikcyjne zlecenie${'</div>'.repeat(depth)}`;
    const started = performance.now();
    const page = extractPage(enc(html), 'text/html', URL_, 20_000);
    expect(performance.now() - started).toBeLessThan(2000);
    expect((page as { text: string }).text).toContain('Fikcyjne zlecenie');
  });

  it('finishes quickly on a maximum-size body of unclosed tags and keeps its text', () => {
    const html = `${'<b>'.repeat(340_000)}Fikcyjne zlecenie`;
    const started = performance.now();
    const page = extractPage(enc(html), 'text/html', URL_, 20_000);
    expect(performance.now() - started).toBeLessThan(2000);
    expect((page as { text: string }).text).toBe('Fikcyjne zlecenie');
  });

  it('drops script and style content on the tag-heavy path, also when unclosed', () => {
    const filler = '<i>'.repeat(25_000);
    const closed = `${filler}<script>sekret()</script><style>p{}</style>Tekst`;
    expect((extractPage(enc(closed), 'text/html', URL_, 100) as { text: string }).text).toBe(
      'Tekst',
    );
    const unclosed = `${filler}Tekst<SCRIPT>sekret()`;
    expect((extractPage(enc(unclosed), 'text/html', URL_, 100) as { text: string }).text).toBe(
      'Tekst',
    );
  });

  it('finishes quickly on many unclosed script tags', () => {
    const started = performance.now();
    const result = extractPage(enc('<script>'.repeat(130_000)), 'text/html', URL_, 100);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result).toBe('no_text');
  });
});
