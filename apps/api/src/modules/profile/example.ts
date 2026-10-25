import type { OperatorProfile } from '@lead-hunter/contracts';

/**
 * DEMO example profile (PRD §16.1): generic skills from the brief, no names, rates, amounts or
 * clients. The operator replaces it with their own profile in the UI; the real one never enters
 * the repository.
 */
export const EXAMPLE_PROFILE: OperatorProfile = {
  skills: [
    'TypeScript',
    'Node.js',
    'React',
    'integracje API',
    'automatyzacje',
    'aplikacje z LLM',
    'Raspberry Pi',
    'ESP32',
    'LoRa',
    'IoT',
    'druk 3D',
    'prototypowanie',
  ],
  experience: '',
  serviceTypes: ['aplikacje webowe', 'integracje', 'prototypy IoT'],
  preferredTechnologies: [],
  excludedTechnologies: [],
  industries: [],
  excludedCategories: [],
  minimumJobValue: null,
  billingModels: ['FIXED_PRICE', 'HOURLY'],
  languages: ['pl', 'en'],
  workModes: ['REMOTE'],
  countries: ['PL'],
  weeklyHours: 20,
  rateRanges: [],
  monthlyRevenueGoal: null,
  effortSplit: { directRevenuePercent: 80, productHypothesisPercent: 20 },
};
