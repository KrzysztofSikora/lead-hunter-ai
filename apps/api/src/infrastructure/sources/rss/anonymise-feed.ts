/** D-20: entries kept in a recorded fixture. */
export const FIXTURE_ENTRIES = 5;

const ENTRY_OPEN = /<(item|entry)[\s>]/g;
const EMAIL = /[^\s<>"'&;@]+@[^\s<>"'&;@]+\.[^\s<>"'&;@]+/g;
const URL_IN_TEXT = /https?:\/\/(?:(?!&(?:quot|lt|gt|apos|#\d+|#x[\da-f]+);)[^\s"'<>\\])+/gi;
const PHONE = /(?<![\w.-])\+?\d[\d ()-]{7,}\d(?![\w-])/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERSON_TAG = /<((?:dc:)?creator|author)(\s[^>]*)?>[\s\S]*?<\/\1>/g;
const OWN_LINKS = [
  /<link(?:\s[^>]*)?>\s*(?:<!\[CDATA\[)?([^<\]]+)/,
  /<link\b[^>]*\bhref="([^"]+)"/,
  /<guid(?:\s[^>]*)?>\s*(?:<!\[CDATA\[)?([^<\]]+)/,
  /<id>\s*([^<\s]+)/,
];

/**
 * Cuts a feed down to its first entries and strips what identifies a person: e-mail addresses,
 * author names, phone-like numbers and every URL inside an entry except that entry's own link. Linear string work on a body that is already size-capped. The person still
 * reviews the file before committing it.
 */
export function anonymiseFeed(xml: string, entries: number = FIXTURE_ENTRIES): string {
  const starts = [...xml.matchAll(ENTRY_OPEN)].map((m) => m.index);
  const first = starts[0];
  if (first === undefined) return scrub(xml, null);

  const tag = /<(item|entry)/.exec(xml.slice(first))?.[1] ?? 'item';
  const close = `</${tag}>`;
  const head = xml.slice(0, first);
  const blocks: string[] = [];
  let cursor = first;
  while (blocks.length < entries) {
    const open = xml.indexOf(`<${tag}`, cursor);
    if (open === -1) break;
    const end = xml.indexOf(close, open);
    if (end === -1) break;
    blocks.push(xml.slice(open, end + close.length));
    cursor = end + close.length;
  }
  const lastEnd = blocks.length > 0 ? cursor : first;
  const tailStart = xml.lastIndexOf(close) + close.length;
  const tail = xml.slice(Math.max(tailStart, lastEnd));

  const scrubbedBlocks = blocks.map((block) => {
    const own = new Set<string>();
    for (const pattern of OWN_LINKS) {
      const found = pattern.exec(block)?.[1]?.trim();
      if (found) own.add(found);
    }
    return scrub(block, own);
  });
  return [scrub(head, null), ...scrubbedBlocks, tail].join('\n    ').replace(/\n {4}$/, '\n');
}

/** `keepUrls` null keeps every URL (the feed's own header: namespaces, channel link). */
function scrub(text: string, keepUrls: ReadonlySet<string> | null): string {
  return text
    .replace(PERSON_TAG, '<$1>DEMO</$1>')
    .replace(EMAIL, 'demo@example.com')
    .replace(URL_IN_TEXT, (url) =>
      keepUrls === null || keepUrls.has(url) ? url : 'https://example.com/demo',
    )
    .replace(PHONE, (match) => (ISO_DATE.test(match) ? match : '+00 000 000 000'));
}
