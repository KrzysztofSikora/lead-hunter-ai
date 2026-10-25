import type { OperatorProfile, PrefilterRule, SourceType } from '@lead-hunter/contracts';
import { matchTerms } from './cues.js';

export interface PrefilterSignal {
  text: string;
  sourceType: SourceType;
  /** UTC epoch ms; null when the source gave no date. */
  publishedAt: number | null;
}

export interface PrefilterOptions {
  now: Date;
  maxAgeDays: number;
}

export interface PrefilterOutcome {
  rule: PrefilterRule | null;
  /** Distinct profile terms found; orders the analysis queue (FR-07 AC3). */
  matches: number;
  language: 'pl' | 'en' | null;
}

const DAY_MS = 86_400_000;
const MAX_LINKS = 10;
const MIN_STOP_WORDS = 3;

const SEEKING_WORK = /^\s*SEEKING\s+WORK\b/i;
const SPAM_PHRASES = [
  'click here to earn',
  'work from home and earn',
  'guaranteed income',
  'crypto giveaway',
  'kliknij i zarabiaj',
  'szybki zarobek',
];

const STOP_WORDS = {
  pl: [
    'się',
    'nie',
    'jest',
    'dla',
    'oraz',
    'jak',
    'że',
    'przy',
    'chcę',
    'szukam',
    'potrzebuję',
    'jestem',
  ],
  en: [
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'are',
    'need',
    'looking',
    'have',
    'from',
    'our',
  ],
} as const;

/** Stop-word counts; null when neither language reaches the minimum or they tie. */
export function detectLanguage(text: string): 'pl' | 'en' | null {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const count = (list: readonly string[]) => words.filter((word) => list.includes(word)).length;
  const pl = count(STOP_WORDS.pl);
  const en = count(STOP_WORDS.en);
  if (Math.max(pl, en) < MIN_STOP_WORDS || pl === en) return null;
  return pl > en ? 'pl' : 'en';
}

/**
 * D-6: hard, explainable rules; the first failing rule wins and anything unknown passes.
 * `too_old` and `no_profile_match` cannot fire for manual imports (no `publishedAt`, and a post
 * the operator pasted on purpose is never dropped for lacking a profile term) — they matter once
 * dated sources arrive (S-10).
 */
export function prefilter(
  signal: PrefilterSignal,
  profile: OperatorProfile,
  options: PrefilterOptions,
): PrefilterOutcome {
  const text = signal.text;
  const matches = matchTerms(text, [
    ...profile.skills,
    ...profile.preferredTechnologies,
    ...profile.serviceTypes,
  ]).length;
  const language = detectLanguage(text);
  const outcome = (rule: PrefilterRule | null): PrefilterOutcome => ({ rule, matches, language });

  if (text.trim() === '') return outcome('no_text');
  if (SEEKING_WORK.test(text)) return outcome('seeking_work');
  const lower = text.toLowerCase();
  const links = text.match(/https?:\/\//gi)?.length ?? 0;
  if (links > MAX_LINKS || SPAM_PHRASES.some((phrase) => lower.includes(phrase))) {
    return outcome('spam');
  }
  if (language !== null && !profile.languages.includes(language)) return outcome('language');
  if (
    signal.publishedAt !== null &&
    options.now.getTime() - signal.publishedAt > options.maxAgeDays * DAY_MS
  ) {
    return outcome('too_old');
  }
  if (matchTerms(text, profile.excludedTechnologies).length > 0) {
    return outcome('excluded_technology');
  }
  if (matchTerms(text, profile.excludedCategories).length > 0) {
    return outcome('excluded_category');
  }
  if (matches === 0 && !signal.sourceType.startsWith('manual_')) {
    return outcome('no_profile_match');
  }
  return outcome(null);
}
