import type { Category, EvidenceLevel } from '@lead-hunter/contracts';
import {
  hasHardwareCue,
  hasHiringCue,
  hasProblemCue,
  hasSubcontractCue,
  matchTerms,
} from '../../modules/analysis/cues.js';
import type { AnalysisInput, LlmProvider, ProviderOutput } from '../../modules/analysis/ports.js';

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
export class MockProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock-rules';
  readonly promptVersion = 'mock-rules-1';
  readonly demo = true;

  analyzeOpportunity(input: AnalysisInput): Promise<ProviderOutput> {
    return Promise.resolve({
      output: this.analyse(input),
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
