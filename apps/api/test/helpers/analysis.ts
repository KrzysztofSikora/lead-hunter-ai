import type { AnalysedResult, OperatorProfile } from '@lead-hunter/contracts';
import { EXAMPLE_PROFILE } from '../../src/modules/profile/example.js';

export const profile = (overrides: Partial<OperatorProfile> = {}): OperatorProfile => ({
  ...EXAMPLE_PROFILE,
  ...overrides,
});

export const analysis = (overrides: Partial<AnalysedResult> = {}): AnalysedResult => ({
  verdict: 'ANALYSED',
  category: 'DIRECT_GIG',
  evidenceLevel: 'DIRECT_REQUEST',
  problem: 'DEMO',
  buyerOrAudience: null,
  buyerConfirmed: false,
  relevantSkills: [],
  solutionApproach: 'DEMO',
  suggestedDeliverable: 'DEMO',
  mvpScope: [],
  exclusions: [],
  monetizationModel: 'FIXED_PRICE',
  estimatedHours: null,
  proposedPrice: null,
  pricingAssumptions: [],
  requiredClarifications: [],
  nextAction: 'DEMO',
  uncertainties: [],
  rationale: 'DEMO',
  sourceFacts: [],
  inferences: [],
  unknowns: [],
  sourceBudget: null,
  industry: null,
  workMode: 'UNKNOWN',
  countries: [],
  ...overrides,
});
