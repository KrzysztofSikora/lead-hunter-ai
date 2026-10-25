import { useState, type FormEvent } from 'react';
import {
  NOTE_MAX_CHARS,
  RejectionReason,
  operatorMoves,
  type OpportunityDetail,
} from '@lead-hunter/contracts';
import styles from './OpportunityPage.module.css';
import { addNote, changeStatus, type ActionOutcome } from './api/opportunities.js';
import { strings } from './strings.pl.js';

const a = strings.opportunity.actions;

type Panel = 'reject' | 'note' | null;

/** Zapisz / Odrzuć / Dodaj notatkę work; the two later actions stay visibly not-yet (D-13). */
export function CardActions({
  data,
  onChange,
}: {
  data: OpportunityDetail;
  onChange: (detail: OpportunityDetail) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const moves = operatorMoves(data.businessStatus);

  async function run(action: () => Promise<ActionOutcome>) {
    setBusy(true);
    setError(null);
    try {
      const outcome = await action();
      if (outcome.ok) {
        onChange(outcome.detail);
        setPanel(null);
        setReason('');
        setText('');
      } else if (outcome.kind === 'conflict') {
        setError(a.conflict);
      } else if (outcome.kind === 'invalid') {
        setError(outcome.fields.map((field) => field.message).join(' '));
      } else {
        setError(a.failed);
      }
    } catch {
      setError(a.failed);
    } finally {
      setBusy(false);
    }
  }

  function open(next: Panel) {
    setError(null);
    setPanel(panel === next ? null : next);
  }

  function submitReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = RejectionReason.safeParse(reason);
    if (!parsed.success) {
      setError(a.reasonPlaceholder);
      return;
    }
    const note = text.trim();
    void run(() =>
      changeStatus(data.id, {
        status: 'REJECTED',
        reason: parsed.data,
        ...(note ? { note } : {}),
      }),
    );
  }

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(() => addNote(data.id, text));
  }

  return (
    <div className={styles.actions}>
      <button
        type="button"
        disabled={busy || !moves.includes('SAVED')}
        onClick={() => void run(() => changeStatus(data.id, { status: 'SAVED' }))}
      >
        {a.save}
      </button>
      <button
        type="button"
        disabled={busy || !moves.includes('REJECTED')}
        aria-expanded={panel === 'reject'}
        onClick={() => open('reject')}
      >
        {a.reject}
      </button>
      <button
        type="button"
        disabled={busy}
        aria-expanded={panel === 'note'}
        onClick={() => open('note')}
      >
        {a.note}
      </button>
      <button type="button" disabled>
        {a.offer}
      </button>
      <button type="button" disabled>
        {a.contact}
      </button>
      <p className={styles.meta}>
        {a.offer}, {a.contact}: {a.later}
      </p>
      {panel === 'reject' && (
        <form className={styles.form} onSubmit={submitReject}>
          <label>
            {a.reasonLabel}
            <select value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="">{a.reasonPlaceholder}</option>
              {RejectionReason.options.map((option) => (
                <option key={option} value={option}>
                  {a.reasons[option]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {a.rejectNote}
            <textarea
              value={text}
              maxLength={NOTE_MAX_CHARS}
              rows={3}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className={styles.formButtons}>
            <button type="submit" disabled={busy}>
              {a.confirmReject}
            </button>
            <button type="button" disabled={busy} onClick={() => setPanel(null)}>
              {a.cancel}
            </button>
          </div>
        </form>
      )}
      {panel === 'note' && (
        <form className={styles.form} onSubmit={submitNote}>
          <label>
            {a.noteLabel}
            <textarea
              value={text}
              maxLength={NOTE_MAX_CHARS}
              rows={3}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className={styles.formButtons}>
            <button type="submit" disabled={busy || text.trim() === ''}>
              {busy ? a.saving : a.saveNote}
            </button>
            <button type="button" disabled={busy} onClick={() => setPanel(null)}>
              {a.cancel}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className={`${styles.error} ${styles.actionError}`}>
          {error}
        </p>
      )}
    </div>
  );
}
