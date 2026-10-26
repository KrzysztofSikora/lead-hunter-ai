import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  BusinessStatus,
  Category,
  Currency,
  DEFAULT_MIN_SCORE,
  SourceType,
  type AnalysisServiceStatus,
  type OpportunityList,
  type OpportunitySummary,
} from '@lead-hunter/contracts';
import styles from './OpportunitiesPage.module.css';
import { getAnalysisStatus } from './api/analysis.js';
import { formatUsd } from './usd.js';
import { listOpportunities, PAGE_SIZE, type ListFilters } from './api/opportunities.js';
import { prefilterReason } from './opportunityCard.js';
import { strings } from './strings.pl.js';
import { formatWarsaw, isCalendarDate, warsawDayEnd, warsawDayStart } from './warsawTime.js';

const t = strings.opportunities;

const LANGUAGES = ['pl', 'en'] as const;
const WORK_MODES = ['REMOTE', 'HYBRID', 'ONSITE'] as const;

/** The contract's upper bound for `maxAgeDays`. */
const MAX_AGE_DAYS = 3650;

function positiveInt(value: string | null, max = 999_999_999): number | undefined {
  return value !== null && /^\d{1,9}$/.test(value) && Number(value) > 0 && Number(value) <= max
    ? Number(value)
    : undefined;
}

/** An amount in currency units with at most two decimals. */
function positiveAmount(value: string | null): number | undefined {
  return value !== null && /^\d{1,9}(\.\d{1,2})?$/.test(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

/** What the URL query says; unknown or malformed values are ignored, never sent. */
function readQuery(params: URLSearchParams) {
  const page = Number(params.get('page'));
  const minScore = params.get('minScore');
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const country = (params.get('country') ?? '').trim().toUpperCase();
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    sort: params.get('sort') === 'score' ? ('score' as const) : ('date' as const),
    minScore:
      minScore !== null && /^\d{1,3}$/.test(minScore) && Number(minScore) <= 100
        ? Number(minScore)
        : undefined,
    category: Category.safeParse(params.get('category')).data,
    sourceType: SourceType.safeParse(params.get('sourceType')).data,
    status: BusinessStatus.safeParse(params.get('status')).data,
    from: isCalendarDate(from) ? from : undefined,
    to: isCalendarDate(to) ? to : undefined,
    maxAgeDays: positiveInt(params.get('maxAgeDays'), MAX_AGE_DAYS),
    minAmount: positiveAmount(params.get('minAmount')),
    currency: Currency.safeParse(params.get('currency')).data,
    language: LANGUAGES.find((value) => value === params.get('language')),
    workMode: WORK_MODES.find((value) => value === params.get('workMode')),
    country: /^[A-Z]{2}$/.test(country) ? country : undefined,
    excludeIndustries: (params.get('excludeIndustries') ?? '').trim() || undefined,
  };
}

const FORM_FIELDS = [
  'minScore',
  'category',
  'sourceType',
  'status',
  'from',
  'to',
  'sort',
  'maxAgeDays',
  'minAmount',
  'currency',
  'language',
  'workMode',
  'country',
  'excludeIndustries',
];

type Query = ReturnType<typeof readQuery>;

/** The Warsaw dates of the form become UTC instants: `from` inclusive, `to` exclusive (D-9). */
function toFilters(query: Query): ListFilters {
  return {
    ...query,
    from: query.from ? warsawDayStart(query.from) : undefined,
    to: query.to ? warsawDayEnd(query.to) : undefined,
  };
}

type StatusLoad =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: AnalysisServiceStatus };

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: OpportunityList };

export function OpportunitiesPage() {
  const [params, setParams] = useSearchParams();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [analysis, setAnalysis] = useState<StatusLoad>({ state: 'loading' });
  const [formError, setFormError] = useState<string | null>(null);
  const query = readQuery(params);
  const key = params.toString();

  useEffect(() => {
    let active = true;
    getAnalysisStatus().then(
      (data) => active && setAnalysis({ state: 'ready', data }),
      () => active && setAnalysis({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [key]);

  useEffect(() => {
    let active = true;
    setLoad({ state: 'loading' });
    listOpportunities(toFilters(readQuery(new URLSearchParams(key)))).then(
      (data) => active && setLoad({ state: 'ready', data }),
      () => active && setLoad({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [key]);

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const name of FORM_FIELDS) {
      const value = String(form.get(name) ?? '').trim();
      if (value) next.set(name, value);
    }
    if (next.has('minAmount') && !next.has('currency')) {
      setFormError(t.amountNeedsCurrency);
      return;
    }
    setFormError(null);
    setParams(next);
  };

  const goTo = (page: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    setParams(next);
  };

  return (
    <section>
      <h2>{t.title}</h2>
      <AnalysisLine load={analysis} />
      <form key={key} className={styles.filters} onSubmit={apply} aria-label={t.filters}>
        <label className={styles.field}>
          {t.minScore}
          <input
            name="minScore"
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            defaultValue={query.minScore ?? ''}
          />
        </label>
        <label className={styles.field}>
          {t.category}
          <select name="category" defaultValue={query.category ?? ''}>
            <option value="">{t.any}</option>
            {Category.options.map((value) => (
              <option key={value} value={value}>
                {t.categories[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t.sourceType}
          <select name="sourceType" defaultValue={query.sourceType ?? ''}>
            <option value="">{t.any}</option>
            {SourceType.options.map((value) => (
              <option key={value} value={value}>
                {t.sourceTypes[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t.status}
          <select name="status" defaultValue={query.status ?? ''}>
            <option value="">{t.any}</option>
            {BusinessStatus.options.map((value) => (
              <option key={value} value={value}>
                {t.businessStatus[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t.from}
          <input name="from" type="date" defaultValue={query.from ?? ''} />
        </label>
        <label className={styles.field}>
          {t.to}
          <input name="to" type="date" defaultValue={query.to ?? ''} />
        </label>
        <label className={styles.field}>
          {t.maxAgeDays}
          <input
            name="maxAgeDays"
            type="number"
            min={1}
            max={MAX_AGE_DAYS}
            inputMode="numeric"
            defaultValue={query.maxAgeDays ?? ''}
          />
        </label>
        <label className={styles.field}>
          {t.minAmount}
          <input
            name="minAmount"
            type="number"
            min={0.01}
            step="0.01"
            inputMode="decimal"
            defaultValue={query.minAmount ?? ''}
          />
        </label>
        <label className={styles.field}>
          {t.currency}
          <select name="currency" defaultValue={query.currency ?? ''}>
            <option value="">{t.any}</option>
            {Currency.options.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t.language}
          <select name="language" defaultValue={query.language ?? ''}>
            <option value="">{t.any}</option>
            {LANGUAGES.map((value) => (
              <option key={value} value={value}>
                {t.languages[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t.workMode}
          <select name="workMode" defaultValue={query.workMode ?? ''}>
            <option value="">{t.any}</option>
            {WORK_MODES.map((value) => (
              <option key={value} value={value}>
                {t.workModes[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t.country}
          <input name="country" maxLength={2} defaultValue={query.country ?? ''} />
        </label>
        <label className={styles.field}>
          {t.excludeIndustries}
          <input name="excludeIndustries" defaultValue={query.excludeIndustries ?? ''} />
        </label>
        <label className={styles.field}>
          {t.sort}
          <select name="sort" defaultValue={query.sort}>
            <option value="date">{t.sortDate}</option>
            <option value="score">{t.sortScore}</option>
          </select>
        </label>
        <div className={styles.actions}>
          <button type="submit">{t.apply}</button>
          <button type="button" onClick={() => setParams(new URLSearchParams())}>
            {t.reset}
          </button>
          <Link to={`/okazje?minScore=${DEFAULT_MIN_SCORE}`}>{t.onlyTop(DEFAULT_MIN_SCORE)}</Link>
        </div>
      </form>
      {formError && <p role="alert">{formError}</p>}

      {load.state === 'loading' && <p role="status">{t.loading}</p>}
      {load.state === 'error' && (
        <p role="alert" className={styles.error}>
          {t.loadFailed}
        </p>
      )}
      {load.state === 'ready' && <Results data={load.data} onPage={goTo} />}
    </section>
  );
}

function Results({ data, onPage }: { data: OpportunityList; onPage: (page: number) => void }) {
  if (data.total === 0) {
    return (
      <div role="status">
        <p>{t.empty}</p>
        <p>{t.sourcesChecked(data.sources.checked)}</p>
        {data.sources.errors.length === 0 ? (
          <p>{t.sourceErrorsNone}</p>
        ) : (
          <>
            <p>{t.sourceErrors}</p>
            <ul>
              {data.sources.errors.map((error) => (
                <li key={`${error.sourceId}-${error.at}`}>
                  {error.source}: {t.sourceFailure[error.reason]}
                  {error.httpStatus === undefined ? '' : ` (HTTP ${error.httpStatus})`} (
                  {formatWarsaw(error.at)})
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  return (
    <>
      <p>{t.total(data.total)}</p>
      <ul className={styles.list}>
        {data.items.map((item) => (
          <li key={item.id} className={styles.item}>
            <h3>
              <Link to={`/okazje/${item.id}`}>{item.source.title}</Link>
            </h3>
            <p className={styles.meta}>
              {t.sourceTypes[item.source.type]}
              {item.source.name !== null && ` — ${item.source.name}`} · {t.detected}{' '}
              {formatWarsaw(item.createdAt)} · {t.businessStatus[item.businessStatus]}
            </p>
            <p className={styles.meta}>
              {analysisLabel(item)} ·{' '}
              {item.analysis?.score != null ? t.score(item.analysis.score) : t.noScore}
              {item.analysis?.demo && <strong className={styles.demo}> · {t.demoBadge}</strong>}
            </p>
            {item.source.excerpt && <p className={styles.excerpt}>{item.source.excerpt}</p>}
          </li>
        ))}
      </ul>
      <div className={styles.pager}>
        <button
          type="button"
          disabled={data.page <= 1}
          onClick={() => onPage(Math.min(data.page - 1, pages))}
        >
          {t.previous}
        </button>
        <span>{t.page(data.page, pages)}</span>
        <button type="button" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)}>
          {t.next}
        </button>
      </div>
    </>
  );
}

function analysisLabel(item: OpportunitySummary): string {
  switch (item.analysisStatus) {
    case 'PENDING':
      return t.analysisPending;
    case 'COMPLETE':
      return t.analysisComplete;
    case 'SKIPPED':
      return item.prefilter?.rule
        ? t.skippedBecause(prefilterReason(item.prefilter.rule, item.prefilter.phrase))
        : t.analysisSkipped;
    default:
      return t.analysisFailed;
  }
}

function AnalysisLine({ load }: { load: StatusLoad }) {
  if (load.state === 'loading') return null;
  if (load.state === 'error') return <p className={styles.meta}>{t.analysisStatusFailed}</p>;
  const status = load.data;
  if (!status.configured) return <p role="status">{t.analysisNotConfigured}</p>;
  const unknown =
    status.budget.unknownCostCount > 0 ? (
      <p role="status">{t.analysisUnknownCost(status.budget.unknownCostCount)}</p>
    ) : null;
  const link = <Link to="/analiza">{t.analysisActivityLink}</Link>;
  const paused = status.paused ? <p role="status">{t.analysisPaused}</p> : null;
  const blocked = blockedMessage(status);
  if (blocked) {
    return (
      <>
        <p role="alert">{blocked}</p>
        {paused}
        {unknown}
        <p>{link}</p>
      </>
    );
  }
  if (status.limitReached) {
    return (
      <>
        <p role="status">{t.analysisLimit(status.dailyLimit, status.waiting)}</p>
        {paused}
        {unknown}
        <p>{link}</p>
      </>
    );
  }
  return (
    <>
      {status.waiting > 0 && <p role="status">{t.analysisWaiting(status.waiting)}</p>}
      {paused}
      {unknown}
      <p>{link}</p>
    </>
  );
}

function blockedMessage(status: AnalysisServiceStatus): string | null {
  switch (status.blocked) {
    case 'budget_missing':
      return t.analysisBlockedMissing;
    case 'price_unknown':
      return t.analysisBlockedPrice(status.model ?? '?');
    case 'budget_reached':
      return t.analysisBlockedReached(
        formatUsd(status.budget.spentMicroUsd),
        formatUsd(status.budget.capMicroUsd ?? 0),
      );
    default:
      return null;
  }
}
