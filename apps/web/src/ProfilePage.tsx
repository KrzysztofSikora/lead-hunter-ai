import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { type Currency } from '@lead-hunter/contracts';
import styles from './ProfilePage.module.css';
import { EXPORT_URL } from './api/data.js';
import { getProfile, saveProfile, type FieldError } from './api/profile.js';
import {
  formToProfile,
  profileToForm,
  type ListKey,
  type MoneyForm,
  type ProfileForm,
  type RateForm,
} from './profileForm.js';
import { strings } from './strings.pl.js';

const t = strings.profile;
type TextKey = ListKey | 'languages' | 'countries';
const CURRENCIES: Currency[] = ['PLN', 'EUR', 'USD'];
const UNITS = ['HOUR', 'DAY', 'PROJECT'] as const;
const BILLING = ['FIXED_PRICE', 'HOURLY', 'DAILY', 'RETAINER'] as const;
const MODES = ['REMOTE', 'HYBRID', 'ONSITE'] as const;
const MAX_RATE_RANGES = 10;

type Load = 'loading' | 'ready' | 'error';
type Save = 'idle' | 'saving' | 'saved' | 'failed' | 'invalid';

/** Custom schema rules carry Polish text; library codes get a Polish text by code (D-6). */
function errorText(error: FieldError): string {
  if (error.code === 'custom') return error.message;
  const byCode = t.errors as Record<string, string>;
  return byCode[error.code] ?? t.errors.generic;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function ProfilePage() {
  const [load, setLoad] = useState<Load>('loading');
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [example, setExample] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [save, setSave] = useState<Save>('idle');

  useEffect(() => {
    let active = true;
    getProfile().then(
      (data) => {
        if (!active) return;
        setForm(profileToForm(data.profile));
        setExample(data.example);
        setLoad('ready');
      },
      () => active && setLoad('error'),
    );
    return () => {
      active = false;
    };
  }, []);

  if (load === 'loading') return <p role="status">{t.loading}</p>;
  if (load === 'error' || !form) {
    return (
      <p role="alert" className={styles.error}>
        {t.loadFailed}
      </p>
    );
  }

  const update = (patch: Partial<ProfileForm>) => {
    setForm({ ...form, ...patch });
    setSave('idle');
  };

  /** Error of the field at `path`, or of anything inside it (list items, nested keys). */
  const errorAt = (path: string): FieldError | undefined =>
    errors.find((error) => error.path === path || error.path.startsWith(`${path}.`));

  const errorProps = (id: string, path: string) =>
    errorAt(path) ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {};

  const errorLine = (id: string, path: string): ReactNode => {
    const error = errorAt(path);
    return error ? (
      <p id={`${id}-error`} className={styles.error}>
        {errorText(error)}
      </p>
    ) : null;
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    const parsed = formToProfile(form);
    if (!parsed.ok) {
      setErrors(parsed.fields);
      setSave('invalid');
      return;
    }
    setSave('saving');
    setErrors([]);
    try {
      const result = await saveProfile(parsed.profile);
      if (result.ok) {
        setForm(profileToForm(result.data.profile));
        setExample(result.data.example);
        setSave('saved');
      } else {
        setErrors(result.fields);
        setSave('invalid');
      }
    } catch {
      setSave('failed');
    }
  }

  const textarea = (key: TextKey) => (
    <div className={styles.field}>
      <label htmlFor={key}>{t.fields[key]}</label>
      <textarea
        id={key}
        rows={4}
        value={form[key]}
        onChange={(event) => update({ [key]: event.target.value })}
        {...errorProps(key, key)}
      />
      <small>{t.listHint}</small>
      {errorLine(key, key)}
    </div>
  );

  const checks = (
    key: 'billingModels' | 'workModes',
    values: readonly string[],
    labels: Record<string, string>,
  ) => (
    <fieldset className={styles.field} {...errorProps(key, key)}>
      <legend>{t.fields[key]}</legend>
      {values.map((value) => (
        <label key={value} className={styles.check}>
          <input
            type="checkbox"
            checked={form[key].includes(value)}
            onChange={() => update({ [key]: toggle(form[key], value) })}
          />
          {labels[value]}
        </label>
      ))}
      {errorLine(key, key)}
    </fieldset>
  );

  const currencySelect = (id: string, value: Currency, onChange: (value: Currency) => void) => (
    <select
      id={id}
      aria-label={t.fields.currency}
      value={value}
      onChange={(event) => onChange(event.target.value as Currency)}
    >
      {CURRENCIES.map((currency) => (
        <option key={currency}>{currency}</option>
      ))}
    </select>
  );

  const money = (key: 'minimumJobValue' | 'monthlyRevenueGoal') => {
    const value: MoneyForm = form[key];
    const path = `${key}.amountMinor`;
    return (
      <div className={styles.field}>
        <label htmlFor={key}>{t.fields[key]}</label>
        <div className={styles.row}>
          <input
            id={key}
            type="text"
            inputMode="decimal"
            value={value.amount}
            onChange={(event) => update({ [key]: { ...value, amount: event.target.value } })}
            {...errorProps(key, path)}
          />
          {currencySelect(`${key}-currency`, value.currency, (currency) =>
            update({ [key]: { ...value, currency } }),
          )}
        </div>
        {errorLine(key, path)}
      </div>
    );
  };

  const updateRate = (index: number, patch: Partial<RateForm>) =>
    update({
      rateRanges: form.rateRanges.map((range, i) => (i === index ? { ...range, ...patch } : range)),
    });

  const rateRow = (range: RateForm, index: number) => {
    const base = `rateRanges.${index}`;
    return (
      <div key={index} className={styles.rate}>
        <div className={styles.row}>
          <select
            aria-label={t.fields.rateUnit}
            value={range.unit}
            onChange={(event) => updateRate(index, { unit: event.target.value })}
          >
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {t.units[unit]}
              </option>
            ))}
          </select>
          {currencySelect(`rate-${index}-currency`, range.currency, (currency) =>
            updateRate(index, { currency }),
          )}
        </div>
        <div className={styles.row}>
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${t.fields.rateMin} ${index + 1}`}
            value={range.min}
            onChange={(event) => updateRate(index, { min: event.target.value })}
            {...errorProps(`rate-${index}-min`, `${base}.minMinor`)}
          />
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${t.fields.rateMax} ${index + 1}`}
            value={range.max}
            onChange={(event) => updateRate(index, { max: event.target.value })}
            {...errorProps(`rate-${index}-max`, `${base}.maxMinor`)}
          />
          <button
            type="button"
            onClick={() => update({ rateRanges: form.rateRanges.filter((_, i) => i !== index) })}
          >
            {t.fields.removeRate}
          </button>
        </div>
        {errorLine(`rate-${index}-min`, `${base}.minMinor`)}
        {errorLine(`rate-${index}-max`, `${base}.maxMinor`)}
      </div>
    );
  };

  const listError = errors.find((error) => error.path === 'rateRanges');

  return (
    <>
      <form className={styles.form} onSubmit={submit} noValidate>
        <h2>
          {t.title}
          {example && <span className={styles.badge}>{t.example}</span>}
        </h2>
        {example && <p>{t.exampleHint}</p>}

        <section>
          <h3>{t.sections.skills}</h3>
          {textarea('skills')}
          <div className={styles.field}>
            <label htmlFor="experience">{t.fields.experience}</label>
            <textarea
              id="experience"
              rows={5}
              value={form.experience}
              onChange={(event) => update({ experience: event.target.value })}
              {...errorProps('experience', 'experience')}
            />
            {errorLine('experience', 'experience')}
          </div>
          {textarea('serviceTypes')}
        </section>

        <section>
          <h3>{t.sections.preferences}</h3>
          {textarea('preferredTechnologies')}
          {textarea('industries')}
          {checks('billingModels', BILLING, t.billingModels)}
          {checks('workModes', MODES, t.workModes)}
          {textarea('languages')}
          {textarea('countries')}
        </section>

        <section>
          <h3>{t.sections.constraints}</h3>
          {textarea('excludedTechnologies')}
          {textarea('excludedCategories')}
          {money('minimumJobValue')}
          <div className={styles.field}>
            <label htmlFor="weeklyHours">{t.fields.weeklyHours}</label>
            <input
              id="weeklyHours"
              type="text"
              inputMode="numeric"
              value={form.weeklyHours}
              onChange={(event) => update({ weeklyHours: event.target.value })}
              {...errorProps('weeklyHours', 'weeklyHours')}
            />
            {errorLine('weeklyHours', 'weeklyHours')}
          </div>
        </section>

        <section>
          <h3>{t.sections.rates}</h3>
          <div className={styles.field}>
            <p>{t.fields.rateRanges}</p>
            {form.rateRanges.map(rateRow)}
            <button
              type="button"
              disabled={form.rateRanges.length >= MAX_RATE_RANGES}
              onClick={() =>
                update({
                  rateRanges: [
                    ...form.rateRanges,
                    { unit: 'HOUR', currency: 'PLN', min: '', max: '' },
                  ],
                })
              }
            >
              {t.fields.addRate}
            </button>
            {listError && (
              <p id="rateRanges-error" className={styles.error}>
                {errorText(listError)}
              </p>
            )}
          </div>
          {money('monthlyRevenueGoal')}
          <fieldset className={styles.field} {...errorProps('effortSplit', 'effortSplit')}>
            <legend>{t.fields.effortSplit}</legend>
            <div className={styles.row}>
              <label htmlFor="directRevenuePercent">{t.fields.directRevenuePercent}</label>
              <input
                id="directRevenuePercent"
                type="text"
                inputMode="numeric"
                value={form.directRevenuePercent}
                onChange={(event) => update({ directRevenuePercent: event.target.value })}
              />
              <label htmlFor="productHypothesisPercent">{t.fields.productHypothesisPercent}</label>
              <input
                id="productHypothesisPercent"
                type="text"
                inputMode="numeric"
                value={form.productHypothesisPercent}
                onChange={(event) => update({ productHypothesisPercent: event.target.value })}
              />
            </div>
            {errorLine('effortSplit', 'effortSplit')}
          </fieldset>
        </section>

        <div className={styles.actions}>
          <button type="submit" disabled={save === 'saving'}>
            {save === 'saving' ? t.saving : t.save}
          </button>
          <p role="status" className={save === 'saved' ? styles.ok : styles.error}>
            {save === 'saved' && t.saved}
            {save === 'failed' && t.saveFailed}
            {save === 'invalid' && t.hasErrors}
          </p>
        </div>
      </form>
      <section className={styles.data}>
        <h3>{t.yourData}</h3>
        <p>{t.yourDataHint}</p>
        <p>
          <a href={EXPORT_URL} download>
            {t.exportData}
          </a>
        </p>
      </section>
    </>
  );
}
