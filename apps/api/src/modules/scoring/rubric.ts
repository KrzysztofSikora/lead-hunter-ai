import {
  SCORE_COMPONENT_MAX as SCORE_MAX,
  type AnalysedResult,
  type Category,
  type EvidenceLevel,
  type MonetizationModel,
  type OperatorProfile,
} from '@lead-hunter/contracts';

/** One component of the breakdown before it gets its `key` (see `score.ts`). */
export interface Scored {
  points: number;
  max: number;
  justification: string;
}

/** D-1/D-2: the rubric of `docs/scoring.md`, version 1. Integer tables, no weighting maths. */
export const DEMAND_POINTS: Readonly<
  Record<EvidenceLevel, { confirmed: number; unconfirmed: number }>
> = {
  DIRECT_REQUEST: { confirmed: 30, unconfirmed: 22 },
  EXPLICIT_PROBLEM: { confirmed: 18, unconfirmed: 12 },
  INDIRECT_SIGNAL: { confirmed: 10, unconfirmed: 6 },
  SPECULATIVE: { confirmed: 6, unconfirmed: 3 },
};

/** Matched profile terms → points. Four or more terms reach the maximum. */
export const SKILL_FIT_POINTS = [0, 10, 16, 21, 25] as const;

export const SPEED_CATEGORY_BASE: Readonly<Record<Category, number>> = {
  DIRECT_GIG: 12,
  B2B_SUBCONTRACT: 10,
  HARDWARE_IOT: 6,
  UNMET_NEED: 4,
  PRODUCT_HYPOTHESIS: 2,
};

/** Upper edge of `estimatedHours.max` (inclusive) → points; above the last edge: 0. */
export const SPEED_HOURS_BANDS: readonly (readonly [number, number])[] = [
  [40, 8],
  [120, 5],
  [400, 2],
];
export const SPEED_HOURS_UNKNOWN = 3;

export const REPEATABILITY_CATEGORY_BASE: Readonly<Record<Category, number>> = {
  PRODUCT_HYPOTHESIS: 8,
  UNMET_NEED: 7,
  B2B_SUBCONTRACT: 6,
  HARDWARE_IOT: 5,
  DIRECT_GIG: 4,
};
const RECURRING_BONUS = 2;
const RECURRING_MODELS: readonly MonetizationModel[] = ['SUBSCRIPTION', 'PRODUCT_SALE'];

/** Implied hourly rate as a share of the profile's minimum hourly rate → points. */
export const PROFITABILITY_RATE_BANDS: readonly (readonly [number, number])[] = [
  [100, 15],
  [75, 10],
  [50, 5],
];
export const PROFITABILITY_NEUTRAL = 5;

export function demand(analysis: AnalysedResult): Scored {
  const row = DEMAND_POINTS[analysis.evidenceLevel];
  const points = analysis.buyerConfirmed ? row.confirmed : row.unconfirmed;
  const buyer = analysis.buyerConfirmed ? 'nabywca potwierdzony' : 'nabywca niepotwierdzony';
  return {
    points,
    max: SCORE_MAX.demand,
    justification: `Poziom dowodu ${analysis.evidenceLevel}, ${buyer}: ${points} pkt.`,
  };
}

export function skillFit(analysis: AnalysedResult, profile: OperatorProfile): Scored {
  const wanted = new Set(
    [...profile.skills, ...profile.preferredTechnologies].map((term) => term.toLowerCase()),
  );
  const excluded = new Set(profile.excludedTechnologies.map((term) => term.toLowerCase()));
  const named = analysis.relevantSkills.map((skill) => skill.trim().toLowerCase());
  const excludedHit = analysis.relevantSkills.find((skill) =>
    excluded.has(skill.trim().toLowerCase()),
  );
  if (excludedHit !== undefined) {
    return {
      points: 0,
      max: SCORE_MAX.skillFit,
      justification: `Zlecenie wymaga wykluczonej technologii (${excludedHit}): 0 pkt.`,
    };
  }
  const matched = [...new Set(named.filter((skill) => wanted.has(skill)))];
  const points = SKILL_FIT_POINTS[Math.min(matched.length, SKILL_FIT_POINTS.length - 1)]!;
  return {
    points,
    max: SCORE_MAX.skillFit,
    justification:
      matched.length === 0
        ? 'Żadna umiejętność z profilu nie pasuje do zlecenia: 0 pkt.'
        : `Pasujące umiejętności z profilu (${matched.length}): ${matched.join(', ')}: ${points} pkt.`,
  };
}

export function speed(analysis: AnalysedResult): Scored {
  const base = SPEED_CATEGORY_BASE[analysis.category];
  const hoursMax = analysis.estimatedHours?.max;
  let band: number;
  let bandText: string;
  if (hoursMax === undefined) {
    band = SPEED_HOURS_UNKNOWN;
    bandText = 'czas pracy nieznany (wartość neutralna)';
  } else {
    band = SPEED_HOURS_BANDS.find(([edge]) => hoursMax <= edge)?.[1] ?? 0;
    bandText = `szacowane do ${hoursMax} h`;
  }
  const points = base + band;
  return {
    points,
    max: SCORE_MAX.speed,
    justification: `Kategoria ${analysis.category} (${base} pkt) + ${bandText} (${band} pkt): ${points} pkt.`,
  };
}

/**
 * Only a budget the source stated counts as an amount. A price the model proposed is a
 * hypothesis built from the profile's own rates, so judging it against those rates would be
 * circular (plan-review #7): it scores neutral.
 */
export function profitability(analysis: AnalysedResult, profile: OperatorProfile): Scored {
  const neutral = (reason: string): Scored => ({
    points: PROFITABILITY_NEUTRAL,
    max: SCORE_MAX.profitability,
    justification: `Brak danych — wartość neutralna (${reason}): ${PROFITABILITY_NEUTRAL} pkt.`,
  });
  const budget = analysis.sourceBudget;
  if (budget === null) {
    return neutral(
      analysis.proposedPrice === null ? 'brak budżetu w źródle' : 'tylko szacunek (hipoteza)',
    );
  }
  const minimum = profile.minimumJobValue;
  if (
    minimum !== null &&
    minimum.currency === budget.currency &&
    budget.maxMinor < minimum.amountMinor
  ) {
    return {
      points: 0,
      max: SCORE_MAX.profitability,
      justification: 'Budżet ze źródła poniżej minimalnej wartości zlecenia z profilu: 0 pkt.',
    };
  }
  const hours = analysis.estimatedHours;
  const rate = profile.rateRanges.find(
    (range) => range.unit === 'HOUR' && range.currency === budget.currency,
  );
  if (hours === null || rate === undefined) {
    return neutral(hours === null ? 'nieznany czas pracy' : 'brak stawki godzinowej w tej walucie');
  }
  // implied = (bmin + bmax) / (hmin + hmax); percent of the minimum rate, integers only.
  const impliedTimes100 = (budget.minMinor + budget.maxMinor) * 100;
  const rateTimesHours = rate.minMinor * (hours.min + hours.max);
  const band = PROFITABILITY_RATE_BANDS.find(
    ([percent]) => impliedTimes100 >= percent * rateTimesHours,
  );
  const points = band?.[1] ?? 0;
  const share = rateTimesHours === 0 ? 100 : Math.round(impliedTimes100 / rateTimesHours);
  return {
    points,
    max: SCORE_MAX.profitability,
    justification: `Budżet ze źródła daje ok. ${share}% minimalnej stawki godzinowej z profilu: ${points} pkt.`,
  };
}

export function repeatability(analysis: AnalysedResult): Scored {
  const base = REPEATABILITY_CATEGORY_BASE[analysis.category];
  const bonus = RECURRING_MODELS.includes(analysis.monetizationModel) ? RECURRING_BONUS : 0;
  const points = Math.min(base + bonus, SCORE_MAX.repeatability);
  return {
    points,
    max: SCORE_MAX.repeatability,
    justification: `Kategoria ${analysis.category} (${base} pkt)${
      bonus > 0 ? ` + model ${analysis.monetizationModel} (${bonus} pkt)` : ''
    }: ${points} pkt.`,
  };
}
