import { useState, type FormEvent } from 'react';
import {
  type Contract,
  Currency,
  NOTE_MAX_CHARS,
  OPERATOR_TARGETS,
  RejectionReason,
  checkMove,
  type BusinessStatus,
  type OpportunityDetail,
  type StatusChangeRequest,
} from '@lead-hunter/contracts';
import styles from './OpportunityPage.module.css';
import { addNote, changeStatus, type ActionOutcome } from './api/opportunities.js';
import { inputToMinor } from './profileForm.js';
import { strings } from './strings.pl.js';

const a = strings.opportunity.actions;

type Panel = 'reject' | 'note' | 'status' | null;

const list = strings.opportunities;

/** S-08 D-14: "Przygotuj ofertę" stays visibly not-yet until S-07. */
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
  const [noteText, setNoteText] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const toSaved = checkMove(data.businessStatus, 'SAVED');
  const toRejected = checkMove(data.businessStatus, 'REJECTED');
  const toContacted = checkMove(data.businessStatus, 'CONTACTED');
  const [target, setTarget] = useState<BusinessStatus | ''>('');
  const [statusNote, setStatusNote] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [contractValue, setContractValue] = useState('');
  const [contractCurrency, setContractCurrency] = useState<Currency>('PLN');
  const [contractStart, setContractStart] = useState('');
  const [contractEnd, setContractEnd] = useState('');
  const targets = OPERATOR_TARGETS.filter(
    (status) => checkMove(data.businessStatus, status).allowed,
  );
  const selected = target ? checkMove(data.businessStatus, target) : null;
  const noteRequired = Boolean(selected?.allowed && selected.noteRequired);

  async function run(action: () => Promise<ActionOutcome>) {
    setBusy(true);
    setError(null);
    try {
      const outcome = await action();
      if (outcome.ok) {
        onChange(outcome.detail);
        setPanel(null);
        setReason('');
        setNoteText('');
        setRejectNote('');
        setTarget('');
        setStatusNote('');
        setStatusReason('');
        setContractValue('');
        setContractStart('');
        setContractEnd('');
      } else if (outcome.kind === 'conflict') {
        setError(outcome.noteRequired ? a.noteRequiredError : a.conflict);
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
    const note = rejectNote.trim();
    void run(() =>
      changeStatus(data.id, {
        status: 'REJECTED',
        reason: parsed.data,
        ...(note ? { note } : {}),
      }),
    );
  }

  function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) {
      setError(a.targetPlaceholder);
      return;
    }
    const note = statusNote.trim();
    if (noteRequired && !note) {
      setError(a.noteRequired);
      return;
    }
    let body: StatusChangeRequest;
    if (target === 'REJECTED') {
      const parsed = RejectionReason.safeParse(statusReason);
      if (!parsed.success) {
        setError(a.reasonPlaceholder);
        return;
      }
      body = { status: 'REJECTED', reason: parsed.data, ...(note ? { note } : {}) };
    } else if (target === 'WON') {
      let contract: Contract | undefined;
      if (contractValue.trim()) {
        const minor = inputToMinor(contractValue);
        if (typeof minor !== 'number' || minor < 1) {
          setError(a.contractValueInvalid);
          return;
        }
        contract = {
          valueMinor: minor,
          currency: contractCurrency,
          ...(contractStart ? { expectedStartOn: contractStart } : {}),
          ...(contractEnd ? { expectedEndOn: contractEnd } : {}),
        };
      }
      body = { status: 'WON', ...(note ? { note } : {}), ...(contract ? { contract } : {}) };
    } else {
      body = { status: target, ...(note ? { note } : {}) } as StatusChangeRequest;
    }
    void run(() => changeStatus(data.id, body));
  }

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(() => addNote(data.id, noteText));
  }

  return (
    <div className={styles.actions}>
      <button
        type="button"
        disabled={busy || !toSaved.allowed || toSaved.noteRequired}
        onClick={() => void run(() => changeStatus(data.id, { status: 'SAVED' }))}
      >
        {a.save}
      </button>
      <button
        type="button"
        disabled={busy || !toRejected.allowed}
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
      <button
        type="button"
        disabled={busy}
        aria-expanded={panel === 'status'}
        onClick={() => open('status')}
      >
        {a.changeStatus}
      </button>
      <button type="button" disabled>
        {a.offer}
      </button>
      <button
        type="button"
        disabled={busy || !toContacted.allowed || toContacted.noteRequired}
        onClick={() => void run(() => changeStatus(data.id, { status: 'CONTACTED' }))}
      >
        {a.contact}
      </button>
      <p className={styles.meta}>{a.offerLater}</p>
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
              value={rejectNote}
              maxLength={NOTE_MAX_CHARS}
              rows={3}
              onChange={(event) => setRejectNote(event.target.value)}
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
      {panel === 'status' && (
        <form className={styles.form} onSubmit={submitStatus}>
          <label>
            {a.targetLabel}
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value as BusinessStatus | '')}
            >
              <option value="">{a.targetPlaceholder}</option>
              {targets.map((status) => (
                <option key={status} value={status}>
                  {list.businessStatus[status]}
                </option>
              ))}
            </select>
          </label>
          {target === 'REJECTED' && (
            <label>
              {a.reasonLabel}
              <select
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
              >
                <option value="">{a.reasonPlaceholder}</option>
                {RejectionReason.options.map((option) => (
                  <option key={option} value={option}>
                    {a.reasons[option]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {target === 'WON' && (
            <>
              <p className={styles.meta}>{a.contractTitle}</p>
              <label>
                {a.contractValue}
                <input
                  inputMode="decimal"
                  value={contractValue}
                  onChange={(event) => setContractValue(event.target.value)}
                />
              </label>
              <label>
                {a.contractCurrency}
                <select
                  value={contractCurrency}
                  onChange={(event) => setContractCurrency(event.target.value as Currency)}
                >
                  {Currency.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {a.contractStart}
                <input
                  type="date"
                  value={contractStart}
                  onChange={(event) => setContractStart(event.target.value)}
                />
              </label>
              <label>
                {a.contractEnd}
                <input
                  type="date"
                  value={contractEnd}
                  onChange={(event) => setContractEnd(event.target.value)}
                />
              </label>
            </>
          )}
          <label>
            {a.statusNote}
            <textarea
              value={statusNote}
              maxLength={NOTE_MAX_CHARS}
              rows={3}
              required={noteRequired}
              onChange={(event) => setStatusNote(event.target.value)}
            />
          </label>
          {noteRequired && <p className={styles.meta}>{a.noteRequired}</p>}
          <div className={styles.formButtons}>
            <button type="submit" disabled={busy || !target}>
              {busy ? a.saving : a.confirmStatus}
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
              value={noteText}
              maxLength={NOTE_MAX_CHARS}
              rows={3}
              onChange={(event) => setNoteText(event.target.value)}
            />
          </label>
          <div className={styles.formButtons}>
            <button type="submit" disabled={busy || noteText.trim() === ''}>
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
