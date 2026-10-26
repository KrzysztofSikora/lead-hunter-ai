import { z } from 'zod';

/** Brief §6.1. */
export const Category = z.enum([
  'DIRECT_GIG',
  'B2B_SUBCONTRACT',
  'UNMET_NEED',
  'PRODUCT_HYPOTHESIS',
  'HARDWARE_IOT',
]);
export type Category = z.infer<typeof Category>;

/** Brief §5.4. */
export const EvidenceLevel = z.enum([
  'DIRECT_REQUEST',
  'PUBLIC_TENDER',
  'EXPLICIT_PROBLEM',
  'INDIRECT_SIGNAL',
  'SPECULATIVE',
]);
export type EvidenceLevel = z.infer<typeof EvidenceLevel>;

export const Confidence = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type Confidence = z.infer<typeof Confidence>;
