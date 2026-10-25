import {
  SCORING_VERSION,
  type AnalysedResult,
  type Confidence,
  type OperatorProfile,
  type ScoreBreakdown,
} from '@lead-hunter/contracts';
import { demand, profitability, repeatability, skillFit, speed } from './rubric.js';

const HIGH_MAX_UNKNOWNS = 2;
const LOW_MIN_UNKNOWNS = 5;

/** D-3: deterministic, never chosen by the provider. */
export function confidenceFor(analysis: AnalysedResult): Confidence {
  if (analysis.evidenceLevel === 'SPECULATIVE' || analysis.unknowns.length >= LOW_MIN_UNKNOWNS) {
    return 'LOW';
  }
  const direct =
    analysis.evidenceLevel === 'DIRECT_REQUEST' || analysis.evidenceLevel === 'EXPLICIT_PROBLEM';
  if (direct && analysis.buyerConfirmed && analysis.unknowns.length <= HIGH_MAX_UNKNOWNS) {
    return 'HIGH';
  }
  return 'MEDIUM';
}

/** PRD §7: explicit rules over the structured analysis. Same input, same output. */
export function scoreAnalysis(analysis: AnalysedResult, profile: OperatorProfile): ScoreBreakdown {
  const components = [
    { key: 'demand' as const, ...demand(analysis) },
    { key: 'skillFit' as const, ...skillFit(analysis, profile) },
    { key: 'speed' as const, ...speed(analysis) },
    { key: 'profitability' as const, ...profitability(analysis, profile) },
    { key: 'repeatability' as const, ...repeatability(analysis) },
  ];
  return {
    version: SCORING_VERSION,
    total: components.reduce((sum, component) => sum + component.points, 0),
    confidence: confidenceFor(analysis),
    components,
  };
}
