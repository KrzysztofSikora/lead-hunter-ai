import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { deriveTitle } from '../../../modules/signals/identity.js';

const TITLE_MAX_CHARS = 200;
const SNIFF_BYTES = 1024;
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
// Readability is superlinear in nesting depth and cannot be interrupted by the fetch deadline.
const READABILITY_MAX_DEPTH = 64;
const READABILITY_MAX_ELEMENTS = 5_000;

export interface ExtractedPage {
  title: string;
  text: string;
}

const cut = (value: string, max: number): string => Array.from(value).slice(0, max).join('');

/** One iterative walk: true while the tree stays within what Readability handles quickly. */
interface TreeNode {
  children: Iterable<TreeNode>;
}

function withinReadabilityLimits(root: TreeNode | null): boolean {
  if (!root) return false;
  let elements = 0;
  const stack: Array<[TreeNode, number]> = [[root, 1]];
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [node, depth] = item;
    elements += 1;
    if (depth > READABILITY_MAX_DEPTH || elements > READABILITY_MAX_ELEMENTS) return false;
    for (const child of node.children) stack.push([child, depth + 1]);
  }
  return true;
}

/** D-10: trim lines, collapse blanks, at most one empty line in a row. */
function normaliseText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\u{a0}]+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decode(body: Uint8Array, label: string | undefined): string {
  if (label) {
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // An unknown label falls back to UTF-8 (D-9).
    }
  }
  return new TextDecoder('utf-8').decode(body);
}

/** D-9: `Content-Type` charset, else a meta declaration in the first 1 024 bytes. */
function charsetOf(body: Uint8Array, header: string): string | undefined {
  const fromHeader = /;\s*charset\s*=\s*"?([\w.:-]+)"?/i.exec(header)?.[1];
  if (fromHeader) return fromHeader;
  const head = new TextDecoder('latin1').decode(body.subarray(0, SNIFF_BYTES));
  return /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1];
}

/**
 * D-9, D-10: the main text of a fetched page. The HTML is parsed, never executed (linkedom runs
 * no scripts), and the result is data for analysis like pasted text.
 */
export function extractPage(
  body: Uint8Array,
  contentType: string,
  url: string,
  maxTextChars: number,
): ExtractedPage | 'unsupported_content' | 'no_text' {
  const mediaType = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  const isHtml = HTML_TYPES.has(mediaType);
  if (!isHtml && mediaType !== 'text/plain') return 'unsupported_content';

  const source = decode(body, charsetOf(body, contentType));

  if (!isHtml) {
    const text = cut(normaliseText(source), maxTextChars);
    if (text === '') return 'no_text';
    return { title: deriveTitle(text, url), text };
  }

  if (source.trim() === '') return 'no_text';

  // Readability rewrites the document it is given, so the fallback reads a second parse.
  const parsed = parseHTML(source).document;
  let article: ReturnType<Readability['parse']> = null;
  if (withinReadabilityLimits(parsed.documentElement)) {
    try {
      article = new Readability(parsed, { maxElemsToParse: READABILITY_MAX_ELEMENTS }).parse();
    } catch {
      // A page Readability cannot take falls back to the body text below.
    }
  }
  const { document } = parseHTML(source);
  let text = normaliseText(article?.textContent ?? '');
  if (text === '' && document.documentElement) {
    for (const node of document.querySelectorAll('script, style, noscript')) node.remove();
    text = normaliseText(document.body?.textContent ?? '');
    // linkedom leaves <body> empty for a fragment without <html>.
    if (text === '') text = normaliseText(document.documentElement?.textContent ?? '');
  }
  text = cut(text, maxTextChars).trim();
  if (text === '') return 'no_text';

  const title = article?.title?.trim() || document.title?.trim() || deriveTitle(text, url);
  return { title: cut(title, TITLE_MAX_CHARS), text };
}
