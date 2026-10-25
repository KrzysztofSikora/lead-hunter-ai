import { useState } from 'react';
import {
  nextDraftStatus,
  type OfferDraft,
  type OfferDraftAction,
  type OpportunityDetail,
} from '@lead-hunter/contracts';
import styles from './OpportunityPage.module.css';
import { patchOfferDraft, type OfferOutcome } from './api/offerDrafts.js';
import { copyText } from './clipboard.js';
import { draftFileName, draftToMarkdown } from './offerMarkdown.js';
import { strings } from './strings.pl.js';
import { formatUsd } from './usd.js';
import { formatWarsaw } from './warsawTime.js';

const o = strings.opportunity.offer;
const tags = strings.opportunity.tags;

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** S-07: the current draft. Nothing here sends anything (NG-01); the operator copies and sends by hand. */
export function OfferDraftPanel({
  data,
  onChange,
}: {
  data: OpportunityDetail;
  onChange: (detail: OpportunityDetail) => void;
}) {
  const draft = data.offerDraft;
  if (!draft) return null;
  return (
    <Panel key={`${draft.id}-${draft.updatedAt}`} draft={draft} data={data} onChange={onChange} />
  );
}

function Panel({
  draft,
  data,
  onChange,
}: {
  draft: OfferDraft;
  data: OpportunityDetail;
  onChange: (detail: OpportunityDetail) => void;
}) {
  const [subject, setSubject] = useState(draft.subject);
  const [message, setMessage] = useState(draft.message);
  const [proposal, setProposal] = useState(draft.proposal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    subject !== draft.subject || message !== draft.message || proposal !== draft.proposal;
  const filled = subject.trim() !== '' && message.trim() !== '' && proposal.trim() !== '';
  const locked = draft.status === 'SENT_MANUALLY';
  const can = (action: OfferDraftAction) => nextDraftStatus(draft.status, action, dirty) !== null;
  const canSave =
    can('save') && filled && (dirty || draft.status === 'DRAFT' || draft.status === 'REVIEWED');
  const clean = !dirty && !busy;

  async function patch(action: () => Promise<OfferOutcome>) {
    setBusy(true);
    setError(null);
    try {
      const outcome = await action();
      if (outcome.ok) onChange(outcome.detail);
      else if (outcome.kind === 'conflict')
        setError(outcome.code === 'not_current' ? o.notCurrent : o.conflict);
      else setError(o.failed);
    } catch {
      setError(o.failed);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    setError(null);
    if (!(await copyText(text))) {
      setError(o.copyFailed);
      return;
    }
    await patch(() => patchOfferDraft(draft.id, { action: 'copied' }));
  }

  async function exportMarkdown() {
    download(draftFileName(data.id), draftToMarkdown(draft, data.source.title));
    await patch(() => patchOfferDraft(draft.id, { action: 'exported' }));
  }

  const c = draft.content;
  return (
    <section className={styles.draft} aria-label={o.title}>
      <h4 className={styles.subheading}>{o.title}</h4>
      {draft.demo && (
        <p role="note" className={styles.demo}>
          <strong>{o.demo}</strong>
        </p>
      )}
      {!draft.analysed && <p className={styles.meta}>{o.noAnalysis}</p>}
      <p className={styles.meta}>
        {o.status}: <strong>{o.statuses[draft.status]}</strong> ·{' '}
        {o.meta(draft.provider, draft.model, formatWarsaw(draft.createdAt))}
        {!draft.demo &&
          draft.costMicroUsd !== null &&
          ` · ${o.cost(formatUsd(draft.costMicroUsd))}`}
      </p>
      {draft.guardNotes.length > 0 && (
        <div role="note" className={styles.demo}>
          <strong>{o.guardNotes}</strong>
          <ul className={styles.plain}>
            {draft.guardNotes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {c && (
        <details className={styles.draftNotes}>
          <summary>
            {o.notes} <span className={`${styles.tag} ${styles.tagInference}`}>{o.modelDraft}</span>
          </summary>
          <h5>{o.problem}</h5>
          <p className={styles.text}>{c.problem}</p>
          <List items={c.plan} />
          <h5>{o.value}</h5>
          <p className={styles.text}>{c.valueProposition}</p>
          <h5>{o.mvpScope}</h5>
          <List items={c.mvpScope} />
          {c.exclusions.length > 0 && (
            <>
              <h5>{o.exclusions}</h5>
              <List items={c.exclusions} />
            </>
          )}
          <h5>
            {o.timeline}{' '}
            <span className={`${styles.tag} ${styles.tagEstimate}`}>{tags.estimate}</span>
          </h5>
          <p className={styles.text}>{o.days(c.timeline.minDays, c.timeline.maxDays)}</p>
          <List items={c.timeline.assumptions} />
          <h5>
            {o.pricing}{' '}
            <span className={`${styles.tag} ${styles.tagEstimate}`}>{tags.estimate}</span>
          </h5>
          <p className={styles.text}>{o.billing(c.pricing.model)}</p>
          {c.pricing.range && (
            <p className={styles.text}>
              {o.range(
                c.pricing.range.minMinor,
                c.pricing.range.maxMinor,
                c.pricing.range.currency,
              )}
            </p>
          )}
          <List items={c.pricing.assumptions} />
          <h5>{o.questions}</h5>
          <List items={c.questions} />
        </details>
      )}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void patch(() =>
            patchOfferDraft(draft.id, { action: 'save', subject, message, proposal }),
          );
        }}
      >
        <label>
          {o.subject}
          <input
            value={subject}
            maxLength={200}
            readOnly={locked}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>
        <label>
          {o.message}
          <textarea
            value={message}
            maxLength={4000}
            rows={10}
            readOnly={locked}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <label>
          {o.proposal}
          <textarea
            value={proposal}
            maxLength={8000}
            rows={14}
            readOnly={locked}
            onChange={(event) => setProposal(event.target.value)}
          />
        </label>
        {dirty && <p className={styles.meta}>{o.dirty}</p>}
        <div className={styles.formButtons}>
          <button type="submit" disabled={busy || locked || !canSave}>
            {o.save}
          </button>
          <button
            type="button"
            disabled={!clean || !can('copied')}
            onClick={() => void copy(`${draft.subject}\n\n${draft.message}`)}
          >
            {o.copy}
          </button>
          <button
            type="button"
            disabled={!clean || !can('copied')}
            onClick={() => void copy(draft.proposal)}
          >
            {o.copyProposal}
          </button>
          <button
            type="button"
            disabled={!clean || !can('exported')}
            onClick={() => void exportMarkdown()}
          >
            {o.exportMd}
          </button>
          <button
            type="button"
            disabled={!clean || !can('sent')}
            onClick={() => void patch(() => patchOfferDraft(draft.id, { action: 'sent' }))}
          >
            {o.markSent}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className={`${styles.error} ${styles.actionError}`}>
          {error}
        </p>
      )}
      {data.offerDraftHistory.length > 0 && (
        <details className={styles.draftNotes}>
          <summary>{o.history(data.offerDraftHistory.length)}</summary>
          {data.offerDraftHistory.map((item) => (
            <details key={item.id}>
              <summary>
                {formatWarsaw(item.createdAt)} · {o.statuses[item.status]}
              </summary>
              <h5>{o.subject}</h5>
              <p className={styles.text}>{item.subject}</p>
              <h5>{o.message}</h5>
              <pre className={styles.text}>{item.message}</pre>
              <h5>{o.proposal}</h5>
              <pre className={styles.text}>{item.proposal}</pre>
            </details>
          ))}
        </details>
      )}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className={styles.plain}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
