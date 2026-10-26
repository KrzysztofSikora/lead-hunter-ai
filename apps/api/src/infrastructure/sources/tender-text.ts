import type { Currency } from '@lead-hunter/contracts';

/** S-18 D-20: notice HTML is cut here before the first pass; the pass itself is linear. */
export const HTML_MAX_CHARS = 200_000;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntity(entity: string): string {
  const named = ENTITIES[entity];
  if (named !== undefined) return named;
  const code = /^#x([0-9a-f]{1,6})$/i.exec(entity)?.[1];
  const point = code !== undefined ? parseInt(code, 16) : /^#(\d{1,7})$/.exec(entity)?.[1];
  const value = typeof point === 'string' ? Number(point) : point;
  if (value === undefined || value > 0x10ffff || (value >= 0xd800 && value < 0xe000)) return ' ';
  return String.fromCodePoint(value);
}

/**
 * D-20: HTML to plain text in one left-to-right pass: tags become a space (block tags a line
 * break), a handful of entities are decoded, whitespace is collapsed. No DOM parser, so the cost
 * is linear in the (bounded) input whatever its nesting. Scripts and styles are dropped.
 */
export function htmlToText(html: string): string {
  const input = html.length > HTML_MAX_CHARS ? html.slice(0, HTML_MAX_CHARS) : html;
  const out: string[] = [];
  let i = 0;
  let skipUntil: string | null = null;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '<') {
      const end = input.indexOf('>', i + 1);
      if (end === -1) break;
      const tag = input.slice(i + 1, end);
      const name = /^\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(tag.slice(0, 40))?.[1]?.toLowerCase();
      if (skipUntil !== null) {
        if (name === skipUntil && tag.startsWith('/')) skipUntil = null;
      } else if (name === 'script' || name === 'style') {
        if (!tag.startsWith('/') && !tag.endsWith('/')) skipUntil = name;
      } else {
        out.push(
          name !== undefined && /^(p|br|div|li|tr|h[1-6]|table|ul|ol|section)$/.test(name)
            ? '\n'
            : ' ',
        );
      }
      i = end + 1;
    } else if (ch === '&' && skipUntil === null) {
      const semicolon = input.indexOf(';', i + 1);
      if (semicolon !== -1 && semicolon - i <= 10) {
        out.push(decodeEntity(input.slice(i + 1, semicolon)));
        i = semicolon + 1;
      } else {
        out.push('&');
        i += 1;
      }
    } else {
      if (skipUntil === null) out.push(ch ?? '');
      i += 1;
    }
  }
  return out
    .join('')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface StatedValue {
  amountMinor: number;
  currency: Currency;
}

const VALUE_LABEL =
  /(?:szacunkow[a-zćńóśźż]*\s+warto[śs][ćc][^\d\n]{0,60}|warto[śs][ćc]\s+(?:zam[óo]wienia|szacunkowa)[^\d\n]{0,60})(\d[\d \u00a0.,]{0,30})\s*(PLN|z[łl]|EUR|euro|USD)/i;

/** `1 234 567,89` / `1234567.89` / `1.234.567,89` to integer minor units, or null. */
export function parseAmountMinor(raw: string): number | null {
  const cleaned = raw.replace(/[ \u00a0]/g, '').replace(/[.,]+$/, '');
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;
  const lastSep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  let whole = cleaned;
  let fraction = '';
  if (lastSep !== -1 && cleaned.length - lastSep - 1 <= 2 && cleaned.length - lastSep - 1 > 0) {
    whole = cleaned.slice(0, lastSep);
    fraction = cleaned.slice(lastSep + 1);
  }
  whole = whole.replace(/[.,]/g, '');
  if (whole === '' || whole.length > 14) return null;
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * D-20: the estimated value only from a labelled amount with a currency we know; anything else is
 * `null` (unknown), never a guess. The pattern is bounded, so its cost is linear in the text.
 */
export function findEstimatedValue(text: string): StatedValue | null {
  const match = VALUE_LABEL.exec(
    text.length > HTML_MAX_CHARS ? text.slice(0, HTML_MAX_CHARS) : text,
  );
  if (!match) return null;
  const amountMinor = parseAmountMinor(match[1] ?? '');
  if (amountMinor === null) return null;
  const unit = (match[2] ?? '').toLowerCase();
  const currency: Currency | null =
    unit === 'pln' || unit.startsWith('z') ? 'PLN' : unit === 'usd' ? 'USD' : 'EUR';
  return { amountMinor, currency };
}

const WARSAW = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `2026-11-20 10:00`, Europe/Warsaw (PRD: UI time zone). */
export const formatWarsaw = (ms: number): string => WARSAW.format(new Date(ms));

/** Offset of Europe/Warsaw from UTC at an instant, in ms. */
function warsawOffset(ms: number): number {
  const local = formatWarsaw(ms).replace(' ', 'T') + ':00Z';
  return Date.parse(local) - Math.floor(ms / 60_000) * 60_000;
}

/**
 * A date string from a notice as a UTC instant. A string without a zone is read as Europe/Warsaw
 * time (`UNVERIFIED` for BZP). Outside 2000..2100 it is `null` (lesson: bound source dates).
 */
export function parseNoticeDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text.length > 40) return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const iso = text.replace(' ', 'T');
  let ms = Date.parse(zoned ? iso : `${iso}${iso.includes('T') ? '' : 'T00:00:00'}Z`);
  if (Number.isNaN(ms)) return null;
  if (!zoned) ms -= warsawOffset(ms);
  return ms >= Date.UTC(2000, 0, 1) && ms < Date.UTC(2100, 0, 1) ? ms : null;
}

export interface TenderTextParts {
  title: string;
  buyer: string | null;
  deadlineAt: number | null;
  valueLine: string | null;
  cpvCodes: readonly string[];
  noticeId: string;
  description: string;
}

/** `Wartość szacunkowa: 123456.78 PLN`: the line the guard takes the budget quote from (D-5, D-6). */
export function valueLine({ amountMinor, currency }: StatedValue): string {
  const whole = Math.floor(amountMinor / 100);
  const cents = String(amountMinor % 100).padStart(2, '0');
  return `Wartość szacunkowa: ${whole}.${cents} ${currency}`;
}

/** D-5: labelled Polish lines, then the notice's own description, cut to `maxChars`. */
export function buildTenderText(parts: TenderTextParts, maxChars: number): string {
  const lines = [parts.title];
  if (parts.buyer !== null) lines.push(`Zamawiający: ${parts.buyer}`);
  if (parts.deadlineAt !== null) {
    lines.push(`Termin składania ofert: ${formatWarsaw(parts.deadlineAt)} (czas warszawski)`);
  }
  if (parts.valueLine !== null) lines.push(parts.valueLine);
  if (parts.cpvCodes.length > 0) lines.push(`Kody CPV: ${parts.cpvCodes.join(', ')}`);
  lines.push(`Numer ogłoszenia: ${parts.noticeId}`);
  const head = lines.join('\n');
  const text = parts.description === '' ? head : `${head}\n\n${parts.description}`;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
