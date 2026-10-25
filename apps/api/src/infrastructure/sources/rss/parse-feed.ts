import { XMLParser } from 'fast-xml-parser';
import { deriveTitle } from '../../../modules/signals/identity.js';
import type { FeedItem } from '../../../modules/sources/ports.js';

export interface ParsedFeed {
  items: FeedItem[];
  /** Entries that carry neither a title, a text nor a link. */
  skipped: number;
}

export const MAX_ENTRIES = 200;
const TITLE_MAX_CHARS = 200;
const CDATA = '__cdata';
const TEXT = '#text';

/**
 * D-13: library entity processing is off (no DOCTYPE expansion); decoding and tag stripping below
 * are linear scans, because the body is untrusted input of up to `FETCH_MAX_BYTES`.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: TEXT,
  cdataPropName: CDATA,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
});

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const HTML_ENTITIES: Record<string, string> = {
  ...XML_ENTITIES,
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
};
const ENTITY = /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi;

function decodeWith(table: Record<string, string>, text: string): string {
  return text.replace(ENTITY, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
    }
    return table[name.toLowerCase()] ?? whole;
  });
}

const BLOCK_TAG = /(?:<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|blockquote|pre|hr)\b[^<>]*>\s*)+/gi;
const ANY_TAG = /<[a-zA-Z/!?][^<>]*>/g;

/** Removes `<name ...>...</name>` with its content; an unclosed element runs to the end. */
function dropElements(source: string, name: string): string {
  const lower = source.toLowerCase();
  const open = `<${name}`;
  const close = `</${name}`;
  let out = '';
  let from = 0;
  for (;;) {
    const start = lower.indexOf(open, from);
    if (start === -1) return out + source.slice(from);
    out += source.slice(from, start);
    const end = lower.indexOf(close, start);
    if (end === -1) return out;
    const gt = lower.indexOf('>', end);
    if (gt === -1) return out;
    from = gt + 1;
  }
}

/** Drops tags (blocks become line breaks), then decodes HTML entities once. */
function htmlToText(html: string): string {
  const stripped = dropElements(dropElements(html, 'script'), 'style')
    .replace(BLOCK_TAG, '\n')
    .replace(ANY_TAG, '');
  return decodeWith(HTML_ENTITIES, stripped)
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Node = unknown;

/** The text of an element as markup: CDATA is taken as is, plain text is XML-decoded once. */
function markup(node: Node): string {
  if (typeof node === 'string') return decodeWith(XML_ENTITIES, node);
  if (node === null || typeof node !== 'object') return '';
  const record = node as Record<string, unknown>;
  const cdata = record[CDATA];
  const parts: string[] = [];
  if (typeof record[TEXT] === 'string') parts.push(decodeWith(XML_ENTITIES, record[TEXT]));
  if (Array.isArray(cdata)) parts.push(...cdata.filter((c): c is string => typeof c === 'string'));
  else if (typeof cdata === 'string') parts.push(cdata);
  return parts.join('');
}

const plain = (node: Node): string => markup(node).replace(/\s+/g, ' ').trim();
const html = (node: Node): string => htmlToText(markup(node));

function attr(node: Node, name: string): string | null {
  if (node === null || typeof node !== 'object') return null;
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return typeof value === 'string' ? value : null;
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

function httpUrl(raw: string, base: string): string | null {
  if (raw.trim() === '' || !URL.canParse(raw.trim(), base)) return null;
  const url = new URL(raw.trim(), base);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

function parseDate(raw: string): number | null {
  if (raw === '') return null;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : at;
}

function asArray(node: Node): Record<string, unknown>[] {
  return Array.isArray(node) ? (node as Record<string, unknown>[]) : [];
}

function mapItem(
  entry: Record<string, unknown>,
  atom: boolean,
  feedUrl: string,
  maxTextChars: number,
  hnrss: boolean,
): FeedItem | null {
  let link: string | null;
  if (atom) {
    const links = asArray(entry.link);
    const chosen = links.find((l) => (attr(l, 'rel') ?? 'alternate') === 'alternate');
    link = chosen ? attr(chosen, 'href') : null;
  } else {
    link = plain(asArray(entry.link)[0]);
  }
  const url = link ? httpUrl(link, feedUrl) : null;
  const guid = plain(atom ? entry.id : entry.guid);
  const key = guid !== '' ? cut(guid, 500) : url;

  const body = atom
    ? (entry.content ?? entry.summary)
    : (entry['content:encoded'] ?? entry.description);
  const text = cut(html(body), maxTextChars);
  const rawTitle = cut(plain(entry.title), TITLE_MAX_CHARS);
  if (rawTitle === '' && text === '' && url === null) return null;

  let title = rawTitle;
  if (hnrss && rawTitle.startsWith('New comment by ') && text !== '')
    title = deriveTitle(text, url);
  else if (title === '') title = deriveTitle(text, url);

  const published = atom ? (entry.published ?? entry.updated) : entry.pubDate;
  return {
    key,
    url,
    title,
    text: text === '' ? title : text,
    publishedAt: parseDate(plain(published)),
  };
}

/** RSS 2.0 or Atom 1.0 from bytes; `'invalid_feed'` for malformed XML or any other document. */
export function parseFeed(
  body: Uint8Array,
  feedUrl: string,
  maxTextChars: number,
): ParsedFeed | 'invalid_feed' {
  let root: Record<string, unknown>;
  try {
    root = parser.parse(new TextDecoder('utf-8').decode(body), true) as Record<string, unknown>;
  } catch {
    return 'invalid_feed';
  }
  const rss = root.rss as Record<string, unknown> | undefined;
  const feed = root.feed as Record<string, unknown> | undefined;
  let entries: Record<string, unknown>[];
  let atom = false;
  if (rss !== null && typeof rss === 'object') {
    const channel = rss.channel as Record<string, unknown> | undefined;
    if (channel === null || typeof channel !== 'object') return 'invalid_feed';
    entries = asArray(channel.item);
  } else if (feed !== null && typeof feed === 'object') {
    atom = true;
    entries = asArray(feed.entry);
  } else {
    return 'invalid_feed';
  }

  const hnrss = URL.canParse(feedUrl) && new URL(feedUrl).hostname === 'hnrss.org';
  const items: FeedItem[] = [];
  let skipped = 0;
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    const item =
      typeof entry === 'object' && entry !== null
        ? mapItem(entry, atom, feedUrl, maxTextChars, hnrss)
        : null;
    if (item === null) skipped += 1;
    else items.push(item);
  }
  return { items, skipped };
}
