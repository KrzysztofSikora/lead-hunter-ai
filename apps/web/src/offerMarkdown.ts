import type { OfferDraft } from '@lead-hunter/contracts';
import { strings } from './strings.pl.js';
import { warsawToday } from './warsawTime.js';

const t = strings.opportunity.offer;

const bullets = (items: string[]) => items.map((item) => `- ${item}`).join('\n');

/** "Eksportuj Markdown" (D-2): the saved text plus the model's working notes, labelled. */
export function draftToMarkdown(draft: OfferDraft, opportunityTitle: string): string {
  const parts = [`# ${opportunityTitle}`, '', `## ${t.subject}`, '', draft.subject, ''];
  parts.push(`## ${t.message}`, '', draft.message, '');
  parts.push(`## ${t.proposal}`, '', draft.proposal, '');
  const c = draft.content;
  if (c) {
    parts.push(`## ${t.notes} (${t.modelDraft})`, '');
    parts.push(`### ${t.problem}`, '', c.problem, '', bullets(c.plan), '');
    parts.push(`### ${t.value}`, '', c.valueProposition, '');
    parts.push(`### ${t.mvpScope}`, '', bullets(c.mvpScope), '');
    if (c.exclusions.length > 0) parts.push(`### ${t.exclusions}`, '', bullets(c.exclusions), '');
    parts.push(
      `### ${t.timeline}`,
      '',
      t.days(c.timeline.minDays, c.timeline.maxDays),
      '',
      bullets(c.timeline.assumptions),
      '',
    );
    parts.push(`### ${t.pricing} (${t.estimate})`, '', t.billing(c.pricing.model), '');
    if (c.pricing.range) {
      const { minMinor, maxMinor, currency } = c.pricing.range;
      parts.push(t.range(minMinor, maxMinor, currency), '');
    }
    parts.push(bullets(c.pricing.assumptions), '');
    parts.push(`### ${t.questions}`, '', bullets(c.questions), '');
  }
  return `${parts.join('\n').trimEnd()}\n`;
}

/** `oferta-<opportunityId>-<YYYY-MM-DD>.md` with the Warsaw date. */
export function draftFileName(opportunityId: number, now: number = Date.now()): string {
  return `oferta-${opportunityId}-${warsawToday(now)}.md`;
}
