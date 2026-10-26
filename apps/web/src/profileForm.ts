import { OperatorProfile, type Currency } from '@lead-hunter/contracts';
import type { FieldError } from './api/profile.js';

export const LIST_KEYS = [
  'skills',
  'serviceTypes',
  'preferredTechnologies',
  'excludedTechnologies',
  'industries',
  'excludedCategories',
] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export type MoneyForm = { amount: string; currency: Currency };
export type RateForm = { unit: string; currency: Currency; min: string; max: string };

/** What the inputs hold: text everywhere, so a half-typed value stays visible until it is valid. */
export type ProfileForm = Record<ListKey, string> & {
  experience: string;
  billingModels: string[];
  workModes: string[];
  languages: string;
  countries: string;
  weeklyHours: string;
  minimumJobValue: MoneyForm;
  monthlyRevenueGoal: MoneyForm;
  rateRanges: RateForm[];
  directRevenuePercent: string;
  productHypothesisPercent: string;
};

/** Minor units to the text of the input: whole units, or two decimals when not whole (D-7). */
export function minorToInput(minor: number): string {
  if (minor % 100 === 0) return String(minor / 100);
  const units = Math.trunc(minor / 100);
  return `${units}.${String(minor % 100).padStart(2, '0')}`;
}

/** Input text to minor units by string arithmetic; text that is not an amount stays text. */
export function inputToMinor(text: string): number | string {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return text;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Hours as typed ("1,5", "2") to whole minutes; text that is not a duration stays text. */
export function hoursToMinutes(text: string): number | string {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return text;
  const hundredths = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Math.round((hundredths * 60) / 100);
}

function integer(text: string): number | string {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : text;
}

/** Trimmed lines without empties and case-insensitive duplicates (D-9). */
export function parseLines(text: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const line of text.split('\n')) {
    const item = line.trim();
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    items.push(item);
  }
  return items;
}

const moneyToForm = (money: OperatorProfile['minimumJobValue']): MoneyForm =>
  money
    ? { amount: minorToInput(money.amountMinor), currency: money.currency }
    : { amount: '', currency: 'PLN' };

const formToMoney = (form: MoneyForm) =>
  form.amount.trim() === ''
    ? null
    : { amountMinor: inputToMinor(form.amount), currency: form.currency };

export function profileToForm(profile: OperatorProfile): ProfileForm {
  return {
    skills: profile.skills.join('\n'),
    serviceTypes: profile.serviceTypes.join('\n'),
    preferredTechnologies: profile.preferredTechnologies.join('\n'),
    excludedTechnologies: profile.excludedTechnologies.join('\n'),
    industries: profile.industries.join('\n'),
    excludedCategories: profile.excludedCategories.join('\n'),
    experience: profile.experience,
    billingModels: [...profile.billingModels],
    workModes: [...profile.workModes],
    languages: profile.languages.join('\n'),
    countries: profile.countries.join('\n'),
    weeklyHours: String(profile.weeklyHours),
    minimumJobValue: moneyToForm(profile.minimumJobValue),
    monthlyRevenueGoal: moneyToForm(profile.monthlyRevenueGoal),
    rateRanges: profile.rateRanges.map((range) => ({
      unit: range.unit,
      currency: range.currency,
      min: minorToInput(range.minMinor),
      max: minorToInput(range.maxMinor),
    })),
    directRevenuePercent: String(profile.effortSplit.directRevenuePercent),
    productHypothesisPercent: String(profile.effortSplit.productHypothesisPercent),
  };
}

export type ParsedForm =
  { ok: true; profile: OperatorProfile } | { ok: false; fields: FieldError[] };

/** Builds the payload from the inputs and runs the shared schema over it. */
export function formToProfile(form: ProfileForm): ParsedForm {
  const candidate = {
    skills: parseLines(form.skills),
    experience: form.experience,
    serviceTypes: parseLines(form.serviceTypes),
    preferredTechnologies: parseLines(form.preferredTechnologies),
    excludedTechnologies: parseLines(form.excludedTechnologies),
    industries: parseLines(form.industries),
    excludedCategories: parseLines(form.excludedCategories),
    minimumJobValue: formToMoney(form.minimumJobValue),
    billingModels: form.billingModels,
    languages: parseLines(form.languages).map((code) => code.toLowerCase()),
    workModes: form.workModes,
    countries: parseLines(form.countries).map((code) => code.toUpperCase()),
    weeklyHours: integer(form.weeklyHours),
    rateRanges: form.rateRanges.map((range) => ({
      unit: range.unit,
      currency: range.currency,
      minMinor: inputToMinor(range.min),
      maxMinor: inputToMinor(range.max),
    })),
    monthlyRevenueGoal: formToMoney(form.monthlyRevenueGoal),
    effortSplit: {
      directRevenuePercent: integer(form.directRevenuePercent),
      productHypothesisPercent: integer(form.productHypothesisPercent),
    },
  };
  const result = OperatorProfile.safeParse(candidate);
  if (result.success) return { ok: true, profile: result.data };
  return {
    ok: false,
    fields: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    })),
  };
}
