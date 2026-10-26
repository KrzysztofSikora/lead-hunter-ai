import type { Category, EvidenceLevel, OfferDraftContent } from '@lead-hunter/contracts';
import {
  hasHardwareCue,
  hasHiringCue,
  hasProblemCue,
  hasSubcontractCue,
  matchTerms,
} from '../../modules/analysis/cues.js';
import {
  type AnalysisInput,
  type LlmProvider,
  ProviderError,
  type ProviderOutput,
} from '../../modules/analysis/ports.js';
import type { OfferDrafter, OfferInput } from '../../modules/offers/ports.js';
import { OFFER_PROMPT_VERSION } from './offer-prompt.js';

const PREFIX = 'DEMO / MOCK: ';
const MIN_CHARS = 80;
const FACT_MAX = 300;

const MVP_SCOPE: Record<Category, string[]> = {
  DIRECT_GIG: [
    `${PREFIX}jedna działająca funkcja z opisu zlecenia`,
    `${PREFIX}instrukcja uruchomienia`,
  ],
  B2B_SUBCONTRACT: [`${PREFIX}wydzielony moduł dla głównego wykonawcy`, `${PREFIX}testy odbiorowe`],
  HARDWARE_IOT: [
    `${PREFIX}prototyp urządzenia z jednym czujnikiem`,
    `${PREFIX}firmware i dokumentacja podłączenia`,
  ],
  UNMET_NEED: [`${PREFIX}prototyp rozwiązania zgłoszonego problemu`],
  PRODUCT_HYPOTHESIS: [`${PREFIX}strona z opisem oferty do sprawdzenia zainteresowania`],
};
const EXCLUSIONS: Record<Category, string[]> = {
  DIRECT_GIG: [`${PREFIX}utrzymanie po odbiorze`, `${PREFIX}zakup licencji i sprzętu`],
  B2B_SUBCONTRACT: [`${PREFIX}praca poza uzgodnionym modułem`],
  HARDWARE_IOT: [`${PREFIX}produkcja seryjna`, `${PREFIX}certyfikacja urządzenia`],
  UNMET_NEED: [`${PREFIX}wdrożenie produkcyjne`],
  PRODUCT_HYPOTHESIS: [`${PREFIX}budowa pełnego produktu`],
};

const HOURS: Record<Category, { min: number; max: number }> = {
  DIRECT_GIG: { min: 20, max: 60 },
  B2B_SUBCONTRACT: { min: 40, max: 120 },
  HARDWARE_IOT: { min: 40, max: 120 },
  UNMET_NEED: { min: 30, max: 100 },
  PRODUCT_HYPOTHESIS: { min: 60, max: 200 },
};

// Space, dot or comma join groups of three digits; a comma or dot before 1-2 digits is the decimal part.
const NUMBER = String.raw`(\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const BUDGET = new RegExp(
  String.raw`(?<!\d[ .,]?)${NUMBER}(?:\s*[-–]\s*${NUMBER})?\s*(PLN|zł|EUR|€|USD|\$)(?![\p{L}\p{N}])`,
  'iu',
);
const CURRENCY = { pln: 'PLN', zł: 'PLN', eur: 'EUR', '€': 'EUR', usd: 'USD', $: 'USD' } as const;

/** Minor units of a matched number: "1.500,50" → 150050. */
function minorUnits(text: string): number {
  const decimal = /[.,](\d{1,2})$/.exec(text);
  const whole = Number((decimal ? text.slice(0, decimal.index) : text).replace(/\D/g, ''));
  return whole * 100 + (decimal ? Number(decimal[1]!.padEnd(2, '0')) : 0);
}

function budgetIn(text: string) {
  const match = BUDGET.exec(text);
  if (!match) return null;
  const low = minorUnits(match[1]!);
  const high = match[2] ? minorUnits(match[2]) : low;
  const currency = CURRENCY[match[3]!.toLowerCase() as keyof typeof CURRENCY];
  const quote = match[0].trim();
  if (!Number.isFinite(low) || !Number.isFinite(high) || quote.length > 500) return null;
  return {
    minMinor: Math.min(low, high),
    maxMinor: Math.max(low, high),
    currency,
    quote,
  };
}

function categoryOf(text: string): Category {
  if (hasHardwareCue(text)) return 'HARDWARE_IOT';
  if (hasSubcontractCue(text)) return 'B2B_SUBCONTRACT';
  if (hasHiringCue(text)) return 'DIRECT_GIG';
  if (hasProblemCue(text)) return 'UNMET_NEED';
  return 'PRODUCT_HYPOTHESIS';
}

function evidenceOf(text: string, profileTerms: number): EvidenceLevel {
  if (hasHiringCue(text)) return 'DIRECT_REQUEST';
  if (hasProblemCue(text)) return 'EXPLICIT_PROBLEM';
  return profileTerms > 0 ? 'INDIRECT_SIGNAL' : 'SPECULATIVE';
}

/**
 * D-15: keyword rules over the source text. Deterministic, offline, and never invents names, URLs
 * or contacts. It reads no configuration or environment (TR-02). Results are rules, not AI.
 */
export class MockProvider implements LlmProvider, OfferDrafter {
  readonly name = 'mock' as const;
  readonly paid = false;
  readonly model = 'mock-rules';
  readonly promptVersion = 'mock-rules-1';
  readonly offerPromptVersion = `mock-${OFFER_PROMPT_VERSION}`;
  readonly demo = true;
  readonly timeoutMs = 0;

  analyzeOpportunity(
    input: AnalysisInput,
    options?: { signal?: AbortSignal },
  ): Promise<ProviderOutput> {
    if (options?.signal?.aborted) return Promise.reject(new ProviderError('cancelled'));
    return Promise.resolve({
      output: this.analyse(input),
      usage: { inputTokens: null, outputTokens: null },
    });
  }

  draftOffer(input: OfferInput): Promise<ProviderOutput> {
    return Promise.resolve({
      output: mockOffer(input),
      usage: { inputTokens: null, outputTokens: null },
    });
  }

  private analyse({ source, profile }: AnalysisInput): unknown {
    const text = source.text;
    if (text.trim().length < MIN_CHARS) {
      return {
        verdict: 'INSUFFICIENT_DATA',
        reason: `${PREFIX}tekst ma mniej niż ${MIN_CHARS} znaków — za mało danych do analizy.`,
        unknowns: ['problem', 'zleceniodawca', 'budżet'],
        sourceFacts: [],
      };
    }
    const skills = matchTerms(text, [...profile.skills, ...profile.preferredTechnologies]);
    const terms = matchTerms(text, [...skills, ...profile.serviceTypes]).length;
    const category = categoryOf(text);
    const evidenceLevel = evidenceOf(text, terms);
    const sourceBudget = budgetIn(text);
    const hours = HOURS[category];
    const rate = profile.rateRanges.find((range) => range.unit === 'HOUR');
    const firstLine = text.trim().split('\n')[0]!.trim().slice(0, FACT_MAX);
    const sourceFacts = [firstLine, ...(sourceBudget ? [sourceBudget.quote] : [])];
    const remote = /(?<![\p{L}\p{N}])(?:remote|zdaln\p{L}*)/iu.test(text);

    return {
      verdict: 'ANALYSED',
      category,
      evidenceLevel,
      problem: `${PREFIX}problem opisany w źródle (reguły słów kluczowych, nie analiza AI).`,
      buyerOrAudience: null,
      buyerConfirmed: false,
      relevantSkills: skills,
      solutionApproach: `${PREFIX}propozycja podejścia wymaga oceny operatora.`,
      suggestedDeliverable: `${PREFIX}ustalić z klientem zakres dostawy.`,
      mvpScope: MVP_SCOPE[category],
      exclusions: EXCLUSIONS[category],
      monetizationModel: sourceBudget ? 'FIXED_PRICE' : 'UNKNOWN',
      estimatedHours: hours,
      proposedPrice: rate
        ? {
            minMinor: hours.min * rate.minMinor,
            maxMinor: hours.max * rate.maxMinor,
            currency: rate.currency,
          }
        : null,
      pricingAssumptions: rate ? ['szacunek: godziny × stawka godzinowa z profilu'] : [],
      requiredClarifications: ['zakres', 'termin', ...(sourceBudget ? [] : ['budżet'])],
      nextAction: `${PREFIX}przeczytaj źródło i oceń, czy odpowiedzieć.`,
      uncertainties: ['wynik oparty na słowach kluczowych'],
      rationale: `${PREFIX}kategoria i poziom dowodu z reguł słów kluczowych.`,
      sourceFacts,
      inferences: [`kategoria ${category} (reguły słów kluczowych)`],
      unknowns: ['zleceniodawca', ...(sourceBudget ? [] : ['budżet'])],
      sourceBudget,
      industry: null,
      workMode: remote ? 'REMOTE' : 'UNKNOWN',
      countries: [],
    };
  }
}

const LINE_MAX = 300;
const HOURS_PER_DAY = 6;

const QUESTION_FALLBACKS = [
  'Jaki jest dokładny zakres pierwszej wersji?',
  'Do kiedy potrzebny jest działający efekt?',
  'Kto po stronie klienta odbiera i testuje wynik?',
];

const MESSAGES = {
  pl: {
    subject: `${PREFIX}propozycja realizacji`,
    message: `${PREFIX}Dzień dobry, zainteresowało mnie to zlecenie. Mogę zająć się pierwszą działającą wersją. Podaję wstępny zakres i szacunek; chętnie doprecyzuję szczegóły.`,
    proposal: (scope: string[], exclusions: string[], questions: string[]) =>
      [
        `# ${PREFIX}Propozycja współpracy B2B`,
        '## Zakres',
        ...scope.map((item) => `- ${item}`),
        '## Poza zakresem',
        ...(exclusions.length ? exclusions.map((item) => `- ${item}`) : ['- do ustalenia']),
        '## Pytania',
        ...questions.map((item) => `- ${item}`),
        '## Rozliczenie',
        'Szacunek z założeniami podany w szkicu; ostateczna wycena po doprecyzowaniu.',
      ].join('\n'),
  },
  en: {
    subject: `${PREFIX}proposal`,
    message: `${PREFIX}Hello, this project caught my interest. I can take on a first working version. Below is a rough scope and estimate; happy to clarify the details.`,
    proposal: (scope: string[], exclusions: string[], questions: string[]) =>
      [
        `# ${PREFIX}B2B proposal`,
        '## Scope',
        ...scope.map((item) => `- ${item}`),
        '## Out of scope',
        ...(exclusions.length ? exclusions.map((item) => `- ${item}`) : ['- to be agreed']),
        '## Questions',
        ...questions.map((item) => `- ${item}`),
        '## Pricing',
        'An estimate with its assumptions is given in the draft; the final quote follows the clarifications.',
      ].join('\n'),
  },
} as const;

const clip = (items: readonly string[]): string[] => items.map((item) => item.slice(0, LINE_MAX));

/** Deterministic templates from the analysis and the profile; no name, URL or contact (TR-02). */
function mockOffer({ analysis, profile, targetLanguage }: OfferInput): OfferDraftContent {
  const language = targetLanguage ?? profile.languages[0] ?? 'pl';
  const texts = MESSAGES[language === 'en' ? 'en' : 'pl'];
  const mvpScope = clip(
    analysis?.mvpScope.length ? analysis.mvpScope : [`${PREFIX}pierwsza działająca wersja`],
  ).slice(0, 10);
  const exclusions = clip(analysis?.exclusions ?? []).slice(0, 10);
  const asked = (analysis?.requiredClarifications ?? []).map(
    (item) => `Proszę o doprecyzowanie: ${item}`,
  );
  const questions = clip([...new Set([...asked, ...QUESTION_FALLBACKS])]).slice(0, 6);
  const hours = analysis?.estimatedHours ?? null;
  const minDays = hours ? Math.max(1, Math.ceil(hours.min / HOURS_PER_DAY)) : 7;
  const maxDays = hours ? Math.max(minDays, Math.ceil(hours.max / HOURS_PER_DAY)) : 21;
  const priced = analysis?.proposedPrice ?? null;

  return {
    language,
    problem: `${PREFIX}problem klienta opisany w źródle (szablon, nie analiza AI).`,
    plan: [
      `${PREFIX}doprecyzować wymagania`,
      `${PREFIX}zbudować pierwszą działającą wersję`,
      `${PREFIX}przekazać wynik z instrukcją`,
    ],
    valueProposition: `${PREFIX}szybka, sprawdzona pierwsza wersja bez zobowiązań poza uzgodnionym zakresem.`,
    mvpScope,
    exclusions,
    timeline: {
      minDays: Math.min(minDays, 365),
      maxDays: Math.min(maxDays, 730),
      assumptions: [
        `${PREFIX}szacunek zakłada ${HOURS_PER_DAY} godzin pracy dziennie i brak zmian zakresu`,
      ],
    },
    pricing: {
      model: profile.billingModels[0] ?? 'UNKNOWN',
      range: priced,
      assumptions: clip(
        analysis?.pricingAssumptions.length
          ? analysis.pricingAssumptions
          : [`${PREFIX}brak stawki w profilu — wycena po doprecyzowaniu`],
      ).slice(0, 6),
    },
    questions,
    message: { subject: texts.subject, body: texts.message },
    proposal: { body: texts.proposal(mvpScope, exclusions, questions) },
  };
}
