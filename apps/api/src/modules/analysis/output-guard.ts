import type { OpportunityAnalysis } from '@lead-hunter/contracts';
import { hasHiringCue } from './cues.js';

export interface GuardedAnalysis {
  result: OpportunityAnalysis;
  notes: string[];
}

const squash = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();

const PAID_CATEGORIES = new Set(['DIRECT_GIG', 'B2B_SUBCONTRACT']);

/**
 * D-14: provider-independent checks after schema validation. What the source did not say is
 * removed or downgraded, and every change is noted. Source text is only compared, never executed.
 */
export function guardAnalysis(result: OpportunityAnalysis, sourceText: string): GuardedAnalysis {
  const notes: string[] = [];
  const haystack = squash(sourceText);
  const inSource = (value: string): boolean => haystack.includes(squash(value));

  const sourceFacts = result.sourceFacts.filter((fact) => {
    if (inSource(fact)) return true;
    notes.push(`Usunięto fakt „ze źródła”, którego nie ma w tekście: „${fact.slice(0, 80)}”.`);
    return false;
  });

  if (result.verdict === 'INSUFFICIENT_DATA') {
    return { result: { ...result, sourceFacts }, notes };
  }

  let sourceBudget = result.sourceBudget;
  if (sourceBudget && !inSource(sourceBudget.quote)) {
    notes.push('Usunięto budżet ze źródła: cytat nie występuje w tekście.');
    sourceBudget = null;
  }

  let { evidenceLevel, category } = result;
  const hiring = hasHiringCue(sourceText);
  if (evidenceLevel === 'DIRECT_REQUEST' && !hiring) {
    notes.push(
      'Poziom dowodu obniżony do EXPLICIT_PROBLEM: w tekście brak zlecenia lub płatności.',
    );
    evidenceLevel = 'EXPLICIT_PROBLEM';
  }
  if (PAID_CATEGORIES.has(category) && !hiring) {
    notes.push(
      `Kategoria ${category} zmieniona na UNMET_NEED: w tekście brak zlecenia lub płatności.`,
    );
    category = 'UNMET_NEED';
  }

  return { result: { ...result, sourceFacts, sourceBudget, evidenceLevel, category }, notes };
}
