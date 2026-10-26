import { useState, type FormEvent } from 'react';
import {
  Currency,
  FOLLOW_UP_STATUSES,
  NOTE_MAX_CHARS,
  calendarDate,
  type OpportunityDetail,
} from '@lead-hunter/contracts';
import styles from './OpportunityPage.module.css';
import { addPayment, setFollowUp, type ActionOutcome } from './api/opportunities.js';
import { inputToMinor } from './profileForm.js';
import { formatMinor, strings } from './strings.pl.js';
import { formatCalendarDate, formatWarsaw, warsawToday } from './warsawTime.js';

const p = strings.opportunity.pipeline;
const a = strings.opportunity.actions;

/** S-08 D-7, D-10: the follow-up date and the payments, each its own small form. */
export function CardPipeline({
  data,
  onChange,
}: {
  data: OpportunityDetail;
  onChange: (detail: OpportunityDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUpDate] = useState(data.followUpOn ?? warsawToday());
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('PLN');
  const [paidOn, setPaidOn] = useState(warsawToday());
  const [paymentNote, setPaymentNote] = useState('');
  const canFollowUp = FOLLOW_UP_STATUSES.includes(data.businessStatus);

  async function run(action: () => Promise<ActionOutcome>, done: () => void) {
    setBusy(true);
    setError(null);
    try {
      const outcome = await action();
      if (outcome.ok) {
        onChange(outcome.detail);
        done();
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

  function submitFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!calendarDate.safeParse(followUp).success) {
      setError(p.followUpInvalid);
      return;
    }
    void run(
      () => setFollowUp(data.id, { on: followUp }),
      () => undefined,
    );
  }

  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const minor = inputToMinor(amount);
    if (typeof minor !== 'number' || minor < 1) {
      setError(p.amountInvalid);
      return;
    }
    if (!calendarDate.safeParse(paidOn).success) {
      setError(p.paidOnInvalid);
      return;
    }
    const note = paymentNote.trim();
    void run(
      () =>
        addPayment(data.id, {
          amountMinor: minor,
          currency,
          paidOn,
          ...(note ? { note } : {}),
        }),
      () => {
        setAmount('');
        setPaymentNote('');
      },
    );
  }

  return (
    <div className={styles.actions}>
      <h4 className={styles.subheading}>{p.followUpTitle}</h4>
      <p className={styles.meta}>
        {data.followUpOn
          ? p.followUpCurrent(formatCalendarDate(data.followUpOn))
          : canFollowUp
            ? p.followUpNone
            : p.followUpUnavailable}
      </p>
      {data.offerDraft?.status === 'SENT_MANUALLY' && !data.followUpOn && (
        <p className={styles.meta}>
          {strings.opportunity.offer.sentOn(formatWarsaw(data.offerDraft.statusChangedAt))}
        </p>
      )}
      {canFollowUp && (
        <form className={styles.form} onSubmit={submitFollowUp}>
          <label>
            {p.followUpLabel}
            <input
              type="date"
              value={followUp}
              min={warsawToday()}
              onChange={(event) => setFollowUpDate(event.target.value)}
            />
          </label>
          <div className={styles.formButtons}>
            <button type="submit" disabled={busy}>
              {p.followUpSave}
            </button>
            {data.followUpOn && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => setFollowUp(data.id, { on: null }),
                    () => undefined,
                  )
                }
              >
                {p.followUpClear}
              </button>
            )}
          </div>
        </form>
      )}
      <h4 className={styles.subheading}>{p.paymentsTitle}</h4>
      <p className={styles.meta}>{p.paymentsHint}</p>
      {data.payments.length === 0 ? (
        <p className={styles.meta}>{p.paymentsNone}</p>
      ) : (
        <ul className={styles.plain}>
          {data.payments.map((payment) => (
            <li key={payment.id}>
              <strong>{formatCalendarDate(payment.paidOn)}</strong> ·{' '}
              {formatMinor(payment.amountMinor, payment.currency)}
              {payment.note && <div className={styles.text}>{payment.note}</div>}
            </li>
          ))}
        </ul>
      )}
      <form className={styles.form} onSubmit={submitPayment}>
        <label>
          {p.amountLabel}
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label>
          {p.currencyLabel}
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
          >
            {Currency.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          {p.paidOnLabel}
          <input
            type="date"
            value={paidOn}
            max={warsawToday()}
            onChange={(event) => setPaidOn(event.target.value)}
          />
        </label>
        <label>
          {p.paymentNoteLabel}
          <textarea
            value={paymentNote}
            maxLength={NOTE_MAX_CHARS}
            rows={2}
            onChange={(event) => setPaymentNote(event.target.value)}
          />
        </label>
        <div className={styles.formButtons}>
          <button type="submit" disabled={busy}>
            {p.paymentSave}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className={`${styles.error} ${styles.actionError}`}>
          {error}
        </p>
      )}
    </div>
  );
}
