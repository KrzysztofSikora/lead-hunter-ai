// Plain-text cue lists shared by the output guard and the mock provider (D-14, D-15). They are
// deliberately small: a cue only has to separate "someone offers to pay / hire" from "someone
// describes a problem", and unknowns stay unknown.

const BEFORE = '(?<![\\p{L}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{N}])';

const cue = (fragments: readonly string[]): RegExp =>
  new RegExp(`${BEFORE}(?:${fragments.join('|')})${AFTER}`, 'iu');

/** Hiring or payment: needed for `DIRECT_REQUEST` and for a paid-job category. */
const HIRING = cue([
  'hiring',
  'looking\\s+for\\s+(?:a\\s+|an\\s+)?(?:freelancer|developer|contractor|engineer|programmer)',
  'seeking\\s+(?:a\\s+|an\\s+)?(?:freelancer|developer|contractor|engineer|programmer)',
  'need(?:s|ed)?\\s+(?:a\\s+|an\\s+)?(?:freelancer|developer|contractor|engineer|programmer)',
  'will\\s+pay',
  'paid',
  'budget',
  'subcontract(?:or|ing)?',
  'szukam',
  'szukamy',
  'poszukuj\\p{L}+',
  'zlec\\p{L}+',
  'zapłac\\p{L}+',
  'płatn\\p{L}+',
  'budżet\\p{L}*',
  'wynagrodzeni\\p{L}+',
  'stawk\\p{L}+',
  'podwykonaw\\p{L}+',
]);

/** A stated problem, without an offer to pay. */
const PROBLEM = cue([
  'bug',
  'crash(?:es|ed)?',
  'error',
  'broken',
  "doesn't\\s+work",
  'does\\s+not\\s+work',
  'problem',
  'issue',
  'nie\\s+działa',
  'błąd',
  'błędy',
  'awari\\p{L}+',
  'brakuje',
  'potrzebuj\\p{L}+',
]);

const HARDWARE = cue([
  'esp32',
  'raspberry\\s+pi',
  'lora',
  'iot',
  'arduino',
  'sensor\\p{L}*',
  'czujnik\\p{L}*',
  'firmware',
  'sterownik\\p{L}*',
  'hardware',
]);

export const hasHiringCue = (text: string): boolean => HIRING.test(text);
export const hasProblemCue = (text: string): boolean => PROBLEM.test(text);
export const hasHardwareCue = (text: string): boolean => HARDWARE.test(text);
export const hasSubcontractCue = (text: string): boolean =>
  /(?<![\p{L}\p{N}])(?:subcontract\p{L}*|podwykonaw\p{L}+)/iu.test(text);

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The distinct `terms` that occur in `text` as whole words, case-insensitive. A term may contain
 * punctuation ("Node.js", "C++"); letters and digits around it break the match.
 */
export function matchTerms(text: string, terms: readonly string[]): string[] {
  const found = new Map<string, string>();
  for (const term of terms) {
    const trimmed = term.trim();
    if (trimmed === '') continue;
    const key = trimmed.toLowerCase();
    if (found.has(key)) continue;
    const pattern = new RegExp(`${BEFORE}${escape(trimmed).replace(/\s+/g, '\\s+')}${AFTER}`, 'iu');
    if (pattern.test(text)) found.set(key, trimmed);
  }
  return [...found.values()];
}
