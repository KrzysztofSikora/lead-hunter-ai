import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BusinessStatus, Category, SourceType, type OpportunityList } from '@lead-hunter/contracts';
import styles from './OpportunitiesPage.module.css';
import { listOpportunities, PAGE_SIZE, type ListFilters } from './api/opportunities.js';
import { strings } from './strings.pl.js';
import { formatWarsaw, isCalendarDate, warsawDayEnd, warsawDayStart } from './warsawTime.js';

const t = strings.opportunities;

/** What the URL query says; unknown or malformed values are ignored, never sent. */
function readQuery(params: URLSearchParams) {
  const page = Number(params.get('page'));
  const minScore = params.get('minScore');
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
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
  };
}

type Query = ReturnType<typeof readQuery>;

/** The Warsaw dates of the form become UTC instants: `from` inclusive, `to` exclusive (D-9). */
function toFilters(query: Query): ListFilters {
  return {
    ...query,
    from: query.from ? warsawDayStart(query.from) : undefined,
    to: query.to ? warsawDayEnd(query.to) : undefined,
  };
}

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: OpportunityList };

export function OpportunitiesPage() {
  const [params, setParams] = useSearchParams();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const query = readQuery(params);
  const key = params.toString();

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
    for (const name of ['minScore', 'category', 'sourceType', 'status', 'from', 'to', 'sort']) {
      const value = String(form.get(name) ?? '').trim();
      if (value) next.set(name, value);
    }
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
        </div>
      </form>

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
                <li key={`${error.source}-${error.at}`}>
                  {error.source}: {error.message} ({formatWarsaw(error.at)})
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
              {t.sourceTypes[item.source.type]} · {t.detected} {formatWarsaw(item.createdAt)} ·{' '}
              {t.businessStatus[item.businessStatus]}
            </p>
            <p className={styles.meta}>
              {item.analysisStatus === 'PENDING'
                ? t.analysisPending
                : item.analysisStatus === 'COMPLETE'
                  ? t.analysisComplete
                  : item.analysisStatus === 'SKIPPED'
                    ? t.analysisSkipped
                    : t.analysisFailed}{' '}
              · {item.analysis?.score != null ? t.score(item.analysis.score) : t.noScore}
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
