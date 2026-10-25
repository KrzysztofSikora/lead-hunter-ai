# Plan: analysis-and-scoring (S-04)

## Goal and end state
Every opportunity with `analysisStatus = PENDING` is picked up without operator action, passes a
deterministic pre-filter, is analysed by a provider behind an `LlmProvider` port (only the
deterministic `mock` provider in this item; real providers are S-05) into a versioned, validated
schema (version `1`), and gets a deterministic 0–100 score with a five-part breakdown and a
separate confidence. The rubric is documented in `docs/scoring.md`.

Observable when done:
- FR-07 AC1: a signal that fails a pre-filter rule is never passed to the provider; its
  opportunity gets `businessStatus = REJECTED`, `analysisStatus = SKIPPED` and the rule id as
  reason (`prefilter.rule`), shown in Polish in the UI.
- FR-07 AC2: an HN comment starting with "SEEKING WORK" is rejected with rule `seeking_work`,
  shown as "oferta wykonawcy, nie zlecenie"; "SEEKING FREELANCER" passes.
- FR-07 AC3: with more passing opportunities than `ANALYSIS_DAILY_LIMIT` (default 20), the
  highest pre-filter matches are analysed first, the rest stay `PENDING` until the next
  Europe/Warsaw day, and `GET /api/analysis/status` plus the *Okazje* view show how many wait.
- FR-08 AC5: without `LLM_PROVIDER` the UI says that analysis is not configured; import, list and
  detail keep working; opportunities stay `PENDING` (the pre-filter still runs).
- FR-08 AC6: with `LLM_PROVIDER=mock` results are deterministic for the same input and every view
  that shows them (list, detail) labels them `DEMO / MOCK`, never as AI analysis.
- FR-08 AC8: when the analysis says "insufficient data" (`verdict = INSUFFICIENT_DATA`), the
  opportunity gets `NEEDS_VERIFICATION`, no score.
- FR-10 AC1: the breakdown has five components (30/25/20/15/10) that sum to the total, each
  within its maximum, each with a written justification.
- FR-10 AC2: demand evidence is capped by evidence level: `DIRECT_REQUEST` 30,
  `EXPLICIT_PROBLEM` 18, `INDIRECT_SIGNAL` 10, `SPECULATIVE` 6.
- FR-10 AC3: an OSS bug report is never `DIRECT_REQUEST` and never a paid-job category, whatever
  the provider says (deterministic evidence guard).
- FR-10 AC4: without a budget in the source `sourceBudget = null`, the opportunity is still
  scored, and every price shown carries "szacunek (hipoteza)".
- FR-10 AC5: scoring the same analysis with the same profile twice gives the same result;
  `confidence` is stored separately; no closing probability exists in any contract.
- FR-10 AC6: `GET /api/opportunities` and the *Okazje* view filter by minimum score (one-click
  default 65), excluded industries, maximum source age, minimum amount, job type (category),
  language and geography; the brief (S-13) reuses the same filter contract.

## Scope
- In: analysis schema v1 and score breakdown contracts; scoring rubric and score (pure, mutation
  target); pre-filter (pure); output guard (source-fact/budget quotes, evidence guard); mock
  provider; `analyses` table and new opportunity columns (migration `0004_*`); analysis runner
  (in-process, serial) kicked after import, at start and by a 10-minute timer; config
  `LLM_PROVIDER` (`mock` only), `ANALYSIS_DAILY_LIMIT`, `PREFILTER_MAX_AGE_DAYS`;
  `GET /api/analysis/status`; analysis fields in the opportunity list/detail DTOs; FR-10 AC6 list
  filters; minimal analysis section and labels in the web views; e2e update; `docs/scoring.md`;
  README.
- Out: Anthropic/OpenAI-compatible adapters, prompts, budget cap, cost, cache by content hash,
  re-analyse route and retry UI, URL/e-mail/person/company guard (S-05: FR-08 AC1–AC4, AC7,
  FR-09); the full §8 card and its actions (S-06); status machine, activity events, rejection
  reasons from §10.2 (S-08); scheduler and job runs (S-12); Today/brief (S-13); rescoring after a
  profile change ([FOLLOW-UP], see *Risks*).

## Findings
- Opportunities already carry nullable `category`, `evidence_level`, `score` (CHECK 0–100),
  `confidence` (`apps/api/src/infrastructure/db/schema.ts:45-69`, S-03 D-4) and are created
  `NEW`/`PENDING` by the import transaction (`apps/api/src/modules/signals/service.ts:66-90`).
  Nothing reads `PENDING` yet.
- `AnalysisStatus` is `PENDING | COMPLETE | FAILED` (`packages/contracts/src/opportunities.ts:26`);
  `AnalysisSummary` is `{ category, evidenceLevel, score, confidence } | null`, null while all four
  columns are null (`opportunities.ts:122-131`, `apps/api/src/modules/opportunities/service.ts:141-148`).
- List filters today: `minScore` (excludes unscored rows, S-03 D-9), `category`, `sourceType`,
  `status`, `from`/`to` (`opportunities.ts:176-188`; `opportunity-repository.ts:46-57`).
- The profile has every field the pre-filter and rubric need: `skills`, `serviceTypes`,
  `preferredTechnologies`, `excludedTechnologies`, `excludedCategories`, `minimumJobValue`,
  `languages`, `rateRanges` (`packages/contracts/src/profile.ts:50-78`); the single reader is
  `ProfileService.get()` (`apps/api/src/modules/profile/service.ts:18`). The example profile has
  `languages ['pl','en']`, no rates (`modules/profile/example.ts`).
- Module layout and lint layers: `modules/<name>/{ports,service,routes}.ts`; only `routes.ts`
  imports Fastify; modules reach drivers via ports; infrastructure is wired in `server.ts` and
  `test/helpers/app.ts` (`eslint.config.js:42-72`). `@anthropic-ai/sdk`/`openai` are already on the
  driver list (`eslint.config.js:12-13`).
- `buildTestApp` builds deps by hand (`apps/api/test/helpers/app.ts:59-96`); a new dep must be added
  there and in `server.ts:164-179`. Auth and OpenAPI tests iterate all routes, so a new route is
  covered without edits (S-03 findings).
- `.env.example` documents every variable; `ENV_VARIABLES` lists names (`packages/config/src/env.ts:6-14`);
  `EnvSchema` is a non-strict object, so the existing `LLM_PROVIDER: 'mock'` in
  `playwright.config.ts` is ignored today and becomes meaningful with this item.
- The e2e import test asserts the *pending* state (`e2e/smoke.spec.ts:109,125`: "Analiza:
  oczekuje", "brak analizy — w kolejce"); with the mock running, these assertions must change to
  the analysed state (behaviour change, not a weakened test).
- Mutation targets for this item: `apps/api/src/modules/scoring/rubric.ts`, `score.ts`
  (`context/test-plan.md` *Mutation targets*); `scripts/mutation-changed.sh:114-119` also lists
  `modules/analysis/prefilter.ts`, `modules/analysis/output-guard.ts` and
  `packages/contracts/src/analysis.ts`, so this plan uses exactly those paths.
- Test budget (`context/test-plan.md`): `test` risks owned here are TR-05 (scoring), TR-01
  (guard: budget quote, source facts), TR-02 (injection), TR-07 (invalid output); TR-25
  (pre-filter) and TR-16 are `none`, so the pre-filter gets no own unit table; its ACs are proved
  by integration tests.
- Zod 4.6.7, probed: a `.strict().refine()` object works as a nullable field inside
  `z.discriminatedUnion('verdict', …)` options; a refine failure reports `path` relative to the
  root (`['hours','max']`); an unknown discriminator gives `invalid_union`. Node's
  `Intl.DateTimeFormat(…, { timeZone: 'Europe/Warsaw', timeZoneName: 'longOffset' })` returns
  `GMT+01:00` on 2026-10-25, enough to compute Warsaw day starts without a dependency.
- No third-party API is called in this item (mock only).

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Demand-evidence caps | `DIRECT_REQUEST` 30, `EXPLICIT_PROBLEM` 18, `INDIRECT_SIGNAL` 10, `SPECULATIVE` 6 | – | Roadmap *Decided up front* | cheap | user (roadmap S-04) |
| D-2 | Rubric of the five components | Explicit integer tables (Design *Rubric*): demand = cap by level, lower value when the buyer is not confirmed; skill fit = count of profile skills/technologies matched (0/10/16/21/25), 0 if an excluded technology is named; speed = category base (≤ 12) + effort band from `estimatedHours.max` (≤ 8, unknown 3); profitability = implied rate vs. the profile's hourly rate and minimum job value (unknown → neutral 5); repeatability = category base + 2 for subscription/product sale, ≤ 10. Rubric version `1` stored with every breakdown | B: weighted fractions (`points = max × factor`, smoother, but rounding makes caps and sums harder to reason about and test); C: let the provider score each component (fewer rules, but breaks PRD §7.2 and CLAUDE.md) | Integer tables are readable in `docs/scoring.md`, make every rule one table row and keep sums exact | cheap (local code; stored breakdowns carry `version`) | agent |
| D-3 | Who decides `confidence` | Deterministic rule in `score.ts`: `HIGH` if level is `DIRECT_REQUEST`/`EXPLICIT_PROBLEM`, buyer confirmed and ≤ 2 unknowns; `LOW` if `SPECULATIVE`, ≥ 5 unknowns or insufficient data; else `MEDIUM` | B: provider returns it (one field less to compute, but a model-chosen label, against §7.2's "explicit rules"); C: fixed `MEDIUM` for mock (simplest, says nothing) | Same reasoning as the score; testable | cheap | agent |
| D-4 | How analysis is triggered | In-process `AnalysisRunner` with one serial drain: `kick()` after every created import (callback injected into the signals routes), once at start, and every 10 minutes (`setInterval(...).unref()`) so work held by the daily limit resumes the next day. Import never waits for analysis. Tests call `runner.drain()` directly | B: analyse inside the import request (simplest, but a real LLM call of up to 120 s, NFR-03, would block the import response); C: wait for the S-12 scheduler (no extra timer, but FR-02 AC3 "without further operator action" would not hold in S-04) | Smallest thing that meets FR-02 AC3 and FR-07 AC3 in one process (CLAUDE.md: no queues); S-12 can call the same `drain()` under its lock | cheap | agent |
| D-5 | What a pre-filter rejection stores | `businessStatus = REJECTED` (only from `NEW`), `analysisStatus = SKIPPED` (new enum value), `prefilter_rule` = rule id; UI maps id → Polish text. Rule `no_text` (URL-only import, nothing to analyse until S-09) sets `NEEDS_VERIFICATION` instead of `REJECTED` | B: keep `businessStatus NEW` and mark only the analysis (the operator still sees it as new, but FR-07 AC1 says "stored as rejected"); C: keep `analysisStatus PENDING` (no enum change, but the runner and the UI would have to read a second column to know it is not waiting) | Literal FR-07 AC1; one enum value keeps "waiting" = `PENDING` | costly (public API enum, stored values) | agent |
| D-6 | Pre-filter rules and order | First failing rule wins, in this order: `no_text`, `seeking_work` (`^\s*SEEKING\s+WORK\b`, case-insensitive), `spam` (phrase list or > 10 links), `language` (detected `pl`/`en` by stop-word counts not in `profile.languages`; undetected passes), `too_old` (`publishedAt` older than `PREFILTER_MAX_AGE_DAYS`, default 30; null passes), `excluded_technology`, `excluded_category` (profile terms as whole words), `no_profile_match` (0 matches; **not applied to manual imports**). `matches` = number of distinct profile terms (skills, technologies, service types) found; it orders the analysis queue (FR-07 AC3). "Duplicates" are already stopped at import (S-03 identity), so no rule repeats it | B: apply `no_profile_match` to manual imports too (one rule set, but a post the operator pasted on purpose would be dropped when the example profile does not name its technology); C: score-like weighting instead of hard rules (softer, but FR-07 asks for named rules) | Cheap rules from §6.2; unknowns pass, so the filter never rejects on a guess | cheap | agent |
| D-7 | Analysis schema v1 shape (`packages/contracts/src/analysis.ts`) | `z.discriminatedUnion('verdict')`: `ANALYSED` = §6.1 fields + `sourceFacts`, `inferences`, `unknowns`, `sourceBudget` (`{ minMinor, maxMinor, currency, quote } \| null`), `industry`, `workMode`, `countries`; `INSUFFICIENT_DATA` = `{ reason, unknowns, sourceFacts }`. Money in integer minor units (`minMinor`/`maxMinor`) instead of §6.1's `{min,max}` numbers; strings ≤ 2000 (short ones ≤ 500), lists ≤ 20 items, hours 1–10 000, `min ≤ max`, strict objects | B: one object with an `insufficientData` flag (simpler type, but the model must fill every other field, which invites invented values); C: §6.1 numbers in major units (closer to the brief, against CLAUDE.md "money as integer minor units") | Union makes "brak wystarczających danych" (§6.4) a first-class answer; extra fields feed FR-10 AC6 filters | costly (stored JSON, schema version 1) | agent |
| D-8 | Where analysis results live | New table `analyses` (one row per attempt: status `COMPLETE`/`FAILED`, provider, model, prompt version, schema version, `result_json`, `breakdown_json`, `guard_notes_json`, `error`, tokens nullable, `created_at`). Opportunities get additive nullable columns: `prefilter_rule`, `prefilter_matches`, `prefilter_at`, `language`, `analysis_provider`, `industry`, `work_mode`, `countries` (`,PL,DE,`), `amount_max_minor`, `amount_currency`. The latest row is the current analysis | B: everything as JSON on `opportunities` (no table, but no history and no daily count); C: separate tables for breakdown and attempts (more normalised, more joins for nothing yet) | §14 names `analyses`; one row per attempt gives the daily count (D-9) and failure history (FR-18 later); denormalised columns make list filters plain SQL (NFR-02) | costly (data shape, migration) | agent |
| D-9 | Daily analysis limit | `ANALYSIS_DAILY_LIMIT` (1–1000, default 20, FR-09 AC3 value) counts `analyses` rows created since the start of the current Europe/Warsaw day, for every provider including mock | B: count only paid providers (mock unlimited; e2e simpler, but the FR-07 AC3 behaviour could not be seen before S-05); C: UTC day (simpler, but "next day" would flip at 01:00/02:00 Warsaw) | One rule for all providers; S-05 adds the budget on top | cheap | agent |
| D-10 | "Not configured" | `LLM_PROVIDER` unset → no provider; the runner still pre-filters but analyses nothing; `GET /api/analysis/status` says `configured: false`. `LLM_PROVIDER` accepts only `mock` in this item (S-05 extends the enum). `.env.example` documents it commented out. The tech-stack line "LLM provider defaults to `mock` when no key is set" (*Local development*) is not followed: it contradicts FR-08 AC5 | B: default to mock when unset (dev convenience, but FR-08 AC5 could never be shown and demo results would appear on a real install) | PRD AC wins; e2e already sets `LLM_PROVIDER=mock` | cheap | prd |
| D-11 | Analysis-status API | `GET /api/analysis/status` → `{ configured, provider: 'mock' \| null, demo, dailyLimit, analysedToday, waiting, limitReached }` (`waiting` = `PENDING` rows with a passed pre-filter) | B: put these counts into `GET /api/opportunities` (one call less, but S-13 Today needs them without a list); C: no endpoint, text only in the list (FR-07 AC3 "count shown" not available to the brief) | Small, read-only; S-05 adds budget fields additively | costly (public API) | agent |
| D-12 | Analysis in the opportunity DTOs | `AnalysisSummary` gains `demo: boolean`; `OpportunitySummary`/`OpportunityDetail` gain `prefilter: { rule \| null, matches, language } \| null`; detail gains `latestAnalysis: { status, provider, model, promptVersion, schemaVersion, demo, createdAt, inputTokens, outputTokens, result, breakdown, guardNotes, error } \| null`. Facts stay in `source`; everything in `latestAnalysis.result` is model output except `result.sourceFacts`/`sourceBudget.quote`, which the guard verified verbatim | B: flatten the result into `analysis` (shorter paths, but mixes verified quotes with inferences); C: a separate `GET /api/opportunities/:id/analysis` (smaller detail payload, one more call for S-06) | Keeps S-03 D-8's facts/inferences split; additive | costly (public API) | agent |
| D-13 | FR-10 AC6 filters and unknown values | New list query params: `maxAgeDays`, `minAmount` + `currency` (both or neither), `language`, `workMode`, `country`, `excludeIndustries` (comma list, ≤ 20). A row is excluded only when its value is **known** and fails; unknown language, amount, industry, geography pass (FR-10 AC4 "not blocked"). Job type = existing `category`. `minScore` keeps S-03 D-9 (unscored excluded). Default 65 = `DEFAULT_MIN_SCORE` in contracts, offered as one link "Tylko ≥ 65" in *Okazje*; the API default stays "no minimum" | B: unknown values excluded (stricter lists, but a post without a budget disappears under a minimum amount, against FR-10 AC4); C: apply 65 by default in the list (literal "default 65", but every freshly imported, still pending or unscored opportunity would vanish from the list right after import) | Honest filtering; the brief (S-13) applies 65 by default | costly (public API) | agent |
| D-14 | Output guard in this item | Provider-independent, after schema validation: (a) `sourceBudget` kept only if its `quote` occurs in the source text (whitespace-normalised, case-insensitive), else null + note; (b) `sourceFacts` entries not found verbatim in the source are dropped + note; (c) evidence guard: `DIRECT_REQUEST` needs a hiring/payment cue in the source text (PL/EN list in `modules/analysis/cues.ts`), otherwise it becomes `EXPLICIT_PROBLEM` and `DIRECT_GIG`/`B2B_SUBCONTRACT` become `UNMET_NEED`, + note. Notes are stored and shown. URL/e-mail/person/company checks stay in S-05 (FR-08 AC4) | B: rely on the provider (mock) only (less code, but S-05's real models would get no AC3 protection); C: do the whole FR-08 AC4 guard now (one guard file finished, but outside the roadmap item) | FR-10 AC3/AC4 and TR-01 hold for any provider | cheap | agent |
| D-15 | Mock provider rules (roadmap *Unknowns*) | Keyword rules over the source text, all deterministic: verdict `INSUFFICIENT_DATA` when the text has < 80 characters; category: hardware words → `HARDWARE_IOT`, subcontract words → `B2B_SUBCONTRACT`, hiring cue → `DIRECT_GIG`, problem cue → `UNMET_NEED`, else `PRODUCT_HYPOTHESIS`; evidence: hiring cue → `DIRECT_REQUEST`, problem cue → `EXPLICIT_PROBLEM`, profile term → `INDIRECT_SIGNAL`, else `SPECULATIVE`; `relevantSkills` = profile terms found; `sourceBudget` from a budget regex with the matched text as quote; hours from a per-category table; price = hours × the profile's first hourly rate range (else null); `buyerOrAudience` null, `buyerConfirmed` false; texts prefixed "DEMO / MOCK:". Model id `mock-rules`, prompt version `mock-rules-1` | B: fixed canned analysis (simplest, but every opportunity would score alike and the UI could not be judged); C: random seeded by hash (varied, but meaningless) | Plausible, explainable and never invents names, URLs or contacts | cheap | agent |
| D-16 | Language of justifications | Rubric justifications are Polish strings built in `rubric.ts` and stored in `breakdown_json` (§7.2 "zapisuj uzasadnienie"); UI chrome stays in `strings.pl.ts` (repo-skeleton D-11) | B: codes + parameters rendered by the web (keeps every string in one module, but the stored breakdown would not be readable on its own and S-13/S-14 would need the same renderer) | The justification is stored data, not UI chrome | cheap | agent |
| D-17 | System status changes and history | Pre-filter and insufficient-data moves change `businessStatus` only when it is still `NEW`; no activity event yet (table arrives in S-08) | B: create `activity_events` now (history from day one, but S-08's table shape decided early) | S-08 owns the status history; the reason stays in `prefilter_rule` / the analysis row | cheap | agent |

## Design

### Contracts (`packages/contracts/src/analysis.ts`, new; exported from `index.ts`)
```
ANALYSIS_SCHEMA_VERSION = 1; SCORING_VERSION = 1; DEFAULT_MIN_SCORE = 65
MonetizationModel = FIXED_PRICE | HOURLY_B2B | SUBSCRIPTION | PRODUCT_SALE | UNKNOWN
AnalysisWorkMode  = REMOTE | HYBRID | ONSITE | UNKNOWN
MoneyRange   = strict { minMinor, maxMinor: int 0..1e11, currency: Currency }, refine min ≤ max
SourceBudget = MoneyRange & { quote: string 1..500 }
HoursRange   = strict { min, max: int 1..10000 }, refine min ≤ max
OpportunityAnalysis = discriminatedUnion('verdict', [
  ANALYSED: strict { category, evidenceLevel, problem, buyerOrAudience|null, buyerConfirmed,
    relevantSkills[], solutionApproach, suggestedDeliverable, monetizationModel,
    estimatedHours: HoursRange|null, proposedPrice: MoneyRange|null, pricingAssumptions[],
    requiredClarifications[], nextAction, uncertainties[], rationale, sourceFacts[], inferences[],
    unknowns[], sourceBudget|null, industry|null, workMode, countries: /^[A-Z]{2}$/[] ≤ 20 },
  INSUFFICIENT_DATA: strict { reason, unknowns[], sourceFacts[] } ])
ScoreComponentKey = demand | skillFit | speed | profitability | repeatability
ScoreBreakdown = strict { version: 1, total: int 0..100, confidence: Confidence,
  components: [ { key, points: int, max: int, justification: string 1..500 } ] length 5 }
  refine: points ≤ max, maxima 30/25/20/15/10 in this order, Σ points = total
PrefilterRule = no_text | seeking_work | spam | language | too_old | excluded_technology
              | excluded_category | no_profile_match
AnalysisServiceStatus = { configured, provider: 'mock'|null, demo, dailyLimit, analysedToday, waiting, limitReached }
```
`opportunities.ts`: `AnalysisStatus` + `SKIPPED`; `AnalysisSummary` + `demo`; summary/detail +
`prefilter`; detail + `latestAnalysis` (D-12); `OpportunityListQuery` + D-13 params.

### Data (`apps/api/migrations/0004_*`, additive)
- `analyses(id PK, opportunity_id FK → opportunities ON DELETE CASCADE, status TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL, schema_version INTEGER
  NOT NULL, result_json TEXT NULL, breakdown_json TEXT NULL, guard_notes_json TEXT NULL,
  error TEXT NULL, input_tokens INTEGER NULL, output_tokens INTEGER NULL, created_at INTEGER NOT
  NULL)`, indexes on `(opportunity_id, id)` and `created_at`.
- `opportunities` + nullable columns of D-8. `error` holds a reason (validation issue paths or
  provider error message), never source text.

### Domain
- `modules/scoring/rubric.ts` (pure): one function per component
  `(analysis: AnalysedResult, profile: OperatorProfile) → { points, max, justification }` plus the
  tables below as exported constants.
- `modules/scoring/score.ts` (pure): `scoreAnalysis(analysis, profile): ScoreBreakdown`
  (components in order, total = Σ, `confidence` per D-3) and `confidenceFor(...)`.
- `modules/analysis/prefilter.ts` (pure): `prefilter(signal: { text, sourceType, publishedAt },
  profile, { now, maxAgeDays }) → { rule: PrefilterRule | null, matches: number, language:
  'pl'|'en'|null }` per D-6.
- `modules/analysis/output-guard.ts` (pure): `guardAnalysis(result, sourceText) → { result, notes:
  string[] }` per D-14; `modules/analysis/cues.ts`: hiring/payment and problem cue lists (PL/EN),
  shared with the mock.
- `modules/shared/warsaw-day.ts` (pure): `startOfWarsawDay(instant): Date` via `Intl` offset.

### Rubric (version 1; also in `docs/scoring.md`)
| Component (max) | Rule |
|---|---|
| demand (30) | `DIRECT_REQUEST` 30 / 22, `EXPLICIT_PROBLEM` 18 / 12, `INDIRECT_SIGNAL` 10 / 6, `SPECULATIVE` 6 / 3 (buyer confirmed / not) |
| skillFit (25) | distinct profile `skills` + `preferredTechnologies` matched in `relevantSkills` (case-insensitive): 0→0, 1→10, 2→16, 3→21, ≥4→25; any `relevantSkills` entry in `excludedTechnologies` → 0 |
| speed (20) | category base `DIRECT_GIG` 12, `B2B_SUBCONTRACT` 10, `HARDWARE_IOT` 6, `UNMET_NEED` 4, `PRODUCT_HYPOTHESIS` 2; + hours band by `estimatedHours.max`: ≤ 40 → 8, ≤ 120 → 5, ≤ 400 → 2, > 400 → 0, unknown → 3 |
| profitability (15) | amount = `sourceBudget` else `proposedPrice` (midpoint); amount max below `minimumJobValue` (same currency) → 0; else implied rate = midpoint / hours midpoint vs. the profile's first `HOUR` rate range in that currency: ≥ min → 15, ≥ 75 % → 10, ≥ 50 % → 5, below → 0; any input unknown or currency mismatch → 5 ("brak danych — wartość neutralna") |
| repeatability (10) | category base `PRODUCT_HYPOTHESIS` 8, `UNMET_NEED` 7, `B2B_SUBCONTRACT` 6, `HARDWARE_IOT` 5, `DIRECT_GIG` 4; + 2 for `SUBSCRIPTION`/`PRODUCT_SALE`; capped at 10 |

### Analysis use case (`modules/analysis/{ports,service,routes}.ts`)
Ports: `AnalysisRepository` (`pendingWithoutPrefilter()`, `savePrefilter(id, outcome, at)`,
`nextWaiting(limit)` ordered by `prefilter_matches DESC, created_at ASC, id ASC`,
`countSince(at)`, `waitingCount()`, `saveComplete(...)`, `saveFailed(...)` — each write one
transaction), `LlmProvider` (`name`, `model`, `promptVersion`, `demo`,
`analyzeOpportunity(input) → Promise<{ output: unknown; usage: { inputTokens, outputTokens } }>`),
`ProfileReader` (`get()`), `Clock`.
`AnalysisInput = { schemaVersion, source: { title, text, url, sourceType }, profile:
{ skills, serviceTypes, preferredTechnologies, excludedTechnologies, languages, rateRanges } }` —
data only, no config (TR-02).
`drain()`: 1) pre-filter every `PENDING` row without a pre-filter result (also when no provider);
2) if a provider exists, while `countSince(startOfWarsawDay(now)) < limit` take the next waiting
row → provider → `OpportunityAnalysis.safeParse` → guard → `scoreAnalysis` → `saveComplete`
(sets columns, `COMPLETE`, `NEEDS_VERIFICATION` for insufficient data when `NEW`); a thrown
provider error or a schema failure → `saveFailed` (`FAILED`, reason; signal untouched).
`kick()` chains one drain at a time; errors are logged without source text.
Route `GET /api/analysis/status` (D-11).

### Mock provider (`infrastructure/llm/mock.ts`)
Implements `LlmProvider` per D-15; never reads config or environment; `demo = true`.

### Error model
| Case | Effect |
|------|--------|
| pre-filter rule fails | `SKIPPED`, `REJECTED` (or `NEEDS_VERIFICATION` for `no_text`), `prefilter_rule` set, provider not called |
| provider throws | `analyses` row `FAILED` with `error = provider_error: <message>`; opportunity `FAILED` |
| output fails schema | `FAILED`, `error = invalid_output: <issue paths>` |
| no provider | rows stay `PENDING`; status `configured: false` |
| bad list query | 400 `ValidationError` (shared handler) |

### Web
*Okazje*: status line from `/api/analysis/status` ("Analiza nie jest skonfigurowana — ustaw
LLM_PROVIDER w .env." / "W kolejce do analizy: N" / "Dzienny limit analiz (L) osiągnięty — N
czeka do jutra"); per item `DEMO / MOCK` text badge on mock results, "Analiza: pominięta —
<rule text>" for `SKIPPED`; new filter controls and the "Tylko ≥ 65" link. Detail: section
*Analiza* with the `DEMO / MOCK — wynik reguł, nie analiza AI` banner, score and five
components with justifications, confidence, evidence level, category, problem/buyer/next step
labelled "wniosek modelu", verified quotes labelled "ze źródła", price "szacunek (hipoteza)",
source budget "ze źródła: „<quote>”", unknowns, guard notes, pre-filter outcome or failure reason.
Every label in `strings.pl.ts`; source text and model text rendered as text.

## Phases

### Phase 1: Analysis contracts and the scoring rubric
- Files:
  - `packages/contracts/src/analysis.ts` (new) + `index.ts`: schema v1, breakdown, enums,
    constants (Design *Contracts*). Contract: D-7, breakdown invariants.
  - `packages/contracts/src/analysis.test.ts` (new): schema boundaries (TR-07): valid
    `ANALYSED` and `INSUFFICIENT_DATA`; rejected: unknown field, unknown verdict, string over limit,
    list over 20, hours 0 and 10 001, `min > max` for hours and money, negative/float minor units,
    bad country code; breakdown refine (sum ≠ total, points > max, wrong order).
  - `apps/api/src/modules/scoring/rubric.ts`, `score.ts` (new): D-2, D-3.
  - `apps/api/src/modules/scoring/rubric.test.ts`, `score.test.ts` (new): one `it.each` table per
    component covering every row and band edge (40/41, 120/121, 400/401 hours; 75 %/50 % rate
    edges; minimum job value; currency mismatch; excluded technology); caps per evidence level
    (FR-10 AC2); property over all category × level × monetization × hours-band combinations:
    Σ = total, each ≤ max, 0 ≤ total ≤ 100, justification non-empty (FR-10 AC1); same input twice
    → deep-equal, and no key matching `/probab/i` in the breakdown (FR-10 AC5); confidence table.
  - `docs/scoring.md` (new, Polish): weights, rubric tables, caps, confidence, version, "szacunek
    (hipoteza)" rule, pre-filter rules (D-6) and the evidence guard (D-14).
- Proves: FR-10 AC1, AC2, AC5 (unit); TR-05, TR-07 (schema part).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Pre-filter, output guard and mock provider
- Files:
  - `apps/api/src/modules/analysis/cues.ts`, `prefilter.ts`, `output-guard.ts` (new): D-6, D-14.
  - `apps/api/src/modules/analysis/output-guard.test.ts` (new) (TR-01, FR-10 AC3/AC4): budget
    quote present → kept; quote absent or altered → `sourceBudget` null + note; a source fact not in
    the text → dropped; an OSS bug report text (`apps/api/test/fixtures/llm/synthetic-oss-bug.txt`,
    DEMO) with a fake `DIRECT_REQUEST`/`DIRECT_GIG` result → `EXPLICIT_PROBLEM`/`UNMET_NEED`;
    a Polish and an English hiring post keep `DIRECT_REQUEST`.
  - `apps/api/src/modules/analysis/ports.ts` (new): `LlmProvider`, `AnalysisInput`,
    `AnalysisRepository`, `ProfileReader`. Contract: data-only provider input (TR-02).
  - `apps/api/src/modules/shared/warsaw-day.ts` (new).
  - `apps/api/src/infrastructure/llm/mock.ts` (new): D-15.
  - `apps/api/test/fixtures/llm/` (new): `synthetic-oss-bug.txt`, `synthetic-injection.txt`,
    `synthetic-direct-pl.txt` (with a budget line), `synthetic-seeking-work.txt`,
    `synthetic-seeking-freelancer.txt` — all fictional, marked DEMO.
- Proves: TR-01 guard rules, FR-10 AC3 for any provider (unit). Pre-filter and mock are proved
  end to end in Phase 3 (TR-25 is `none`).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: Storage, runner and configuration
- Files:
  - `packages/config/src/env.ts`, `env.test.ts`, `.env.example`: `LLM_PROVIDER` (`mock`),
    `ANALYSIS_DAILY_LIMIT` (1–1000, 20), `PREFILTER_MAX_AGE_DAYS` (1–365, 30) in `EnvSchema`,
    `ENV_VARIABLES`, `EXPECTED`, `Config`; template lines state real defaults and that unset
    `LLM_PROVIDER` means "analysis not configured" (lesson: no comment about config that does not
    exist).
  - `apps/api/src/infrastructure/db/schema.ts`, `apps/api/migrations/0004_*.sql`, `meta/*`
    (`db:generate`): D-8.
  - `apps/api/src/infrastructure/db/analysis-repository.ts` (new): `AnalysisRepository`.
  - `apps/api/src/modules/analysis/service.ts` (new): runner (`drain`, `kick`) per Design.
  - `apps/api/src/modules/signals/routes.ts`: optional `onCreated` callback after a `created`
    result. Contract: import response unchanged.
  - `apps/api/src/app.ts`, `server.ts`, `test/helpers/app.ts`: wiring; provider from config
    (`mock` → `createMockProvider()`, unset → none); start-up kick and 10-minute timer in
    `server.ts` only; the test helper returns the runner and accepts a fake provider override.
  - `apps/api/test/analysis.int.test.ts` (new), rows read through `openTestDb(dir)`:
    - main path (FR-08 AC6, FR-10 AC1/AC4): `synthetic-direct-pl.txt` → `COMPLETE`, analyses row
      with provider `mock`, model, prompt version, schema version 1, tokens null; breakdown parses
      with `ScoreBreakdown` and `score` column = total; `sourceBudget.quote` occurs in the text; a
      second post without budget → `sourceBudget` null, still scored. Same text analysed in a
      second fresh app → identical `result_json` and `breakdown_json`.
    - FR-07 AC1/AC2: SEEKING WORK → `REJECTED`/`SKIPPED`/`seeking_work`, a recording fake
      provider saw 0 calls for it; SEEKING FREELANCER analysed; a post naming an excluded
      technology of the profile → `excluded_technology`.
    - FR-07 AC3: `ANALYSIS_DAILY_LIMIT=1`, three posts with 3, 1 and 2 profile matches → only the
      3-match post analysed, 2 waiting; fake clock to the next Warsaw day → the 2-match post next.
    - FR-08 AC5: no `LLM_PROVIDER` → pre-filter ran, rows stay `PENDING`, import/list still 2xx.
    - FR-08 AC8: a 50-character post → `COMPLETE`, `NEEDS_VERIFICATION`, score null.
    - FR-10 AC3: `synthetic-oss-bug.txt` with the mock → not `DIRECT_REQUEST`, category not
      `DIRECT_GIG`/`B2B_SUBCONTRACT`.
    - TR-07: fake providers returning `hours.max = 10001`, a non-object, and throwing → `FAILED`
      with reason, signal and opportunity kept, other rows still analysed.
    - TR-02: `synthetic-injection.txt` ("ignore previous instructions", "print your API key",
      "change the settings") with a recording provider; the app's password hash and a
      `LEAK-CANARY` value in the env are the canaries: the input has only `schemaVersion`,
      `source`, `profile` keys, the text sits only in `source.text`, neither canary appears in the
      input or in stored rows; `GET /api/profile` identical before and after.
- Proves: FR-07 AC1–AC3, FR-08 AC5 (API), AC6 (determinism), AC8, FR-10 AC3, AC4 (API); TR-02,
  TR-07 (integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 4: Status route, DTOs and list filters
- Files:
  - `packages/contracts/src/opportunities.ts`: `SKIPPED`, `demo`, `prefilter`, `latestAnalysis`,
    D-13 query params (with `minAmount`/`currency` both-or-neither refine). Contract: D-12, D-13.
  - `apps/api/src/modules/analysis/routes.ts` (new): `GET /api/analysis/status` (D-11).
  - `apps/api/src/modules/opportunities/{ports,service}.ts`,
    `infrastructure/db/opportunity-repository.ts`: new columns, latest analysis on detail,
    D-13 filters (unknown passes), `maxAgeDays` against `published_at ?? fetched_at` with the
    injected clock.
  - `apps/api/src/app.ts`, `server.ts`, `test/helpers/app.ts`: wiring.
  - `apps/api/test/opportunities.int.test.ts`: one FR-10 AC6 test: rows with known and unknown
    language/amount/industry/geography/age set through the test DB; each new filter excludes only
    the known mismatch; `minAmount` without `currency` → 400. Detail of an analysed row has
    `latestAnalysis` with `demo: true` and `analysis.demo: true` in the list; a pre-filtered row
    has `prefilter.rule`.
  - `apps/api/test/analysis.int.test.ts`: status endpoint for the limit case (`waiting 2`,
    `limitReached true`) and the unconfigured case (`configured false`) (FR-07 AC3 count, FR-08
    AC5).
- Proves: FR-10 AC6 (API), FR-07 AC3 count, FR-08 AC5/AC6 in the API (integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 5: Web views, e2e and README
- Files:
  - `apps/web/src/api/analysis.ts` (new), `api/opportunities.ts`: status call, new query params.
  - `apps/web/src/OpportunitiesPage.tsx`, `.module.css`: status line, `DEMO / MOCK` badge,
    skipped reason, new filters, "Tylko ≥ 65".
  - `apps/web/src/OpportunityPage.tsx`, `.module.css`: *Analiza* section (Design *Web*).
  - `apps/web/src/strings.pl.ts`: all new labels; `prefilterRules.seeking_work` = "oferta
    wykonawcy, nie zlecenie".
  - `e2e/smoke.spec.ts`: the import test uses a longer DEMO post with a budget line; after import
    the list (reloaded until analysed) shows `DEMO / MOCK` and a score; the detail shows the
    *Analiza* section with five components and "szacunek (hipoteza)"; replaces the pending-state
    assertions (Findings); screenshots `context/changes/analysis-and-scoring/evidence/{list-360,
    detail-360}.png`. No new spec file, no extra login.
  - `README.md`: *Co działa* (pre-filter, mock analysis labelled DEMO / MOCK, scoring, filters,
    `docs/scoring.md`), *Co wymaga kluczy* (real LLM in S-05), new env variables.
- Proves: FR-08 AC5/AC6 and FR-10 AC4 labels in the UI (e2e + human checks).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`; `pnpm e2e` if Chromium is available
  (otherwise a `[minor]` deviation; `/review` runs it).
- Human checks:
  - With `LLM_PROVIDER=mock`, import `apps/api/test/fixtures/llm/synthetic-direct-pl.txt` and open
    it at 360 px: `DEMO / MOCK` is visible in the list and on the detail, the five components add
    up to the score, justifications read as sensible Polish, the price says "szacunek
    (hipoteza)"; evidence `evidence/detail-360.png`.
  - Without `LLM_PROVIDER` (restart): *Okazje* says analysis is not configured; import still
    works and the item stays "Analiza: oczekuje".
  - Import `synthetic-seeking-work.txt`: the list shows "Analiza: pominięta — oferta wykonawcy,
    nie zlecenie" and status *Odrzucona*.
  - Try each new filter and "Tylko ≥ 65" on 3+ imports: results match, an item without a budget
    stays under a minimum amount; no horizontal scroll; Polish labels read well.
  - Read `docs/scoring.md`: the rubric is understandable and the numbers match what the detail
    shows.

## Risks and unknowns
- The evidence guard (D-14) depends on a cue list; a real hiring post without any listed cue would
  be downgraded once S-05 brings real models. The guard note makes it visible; the list lives in
  one file (`cues.ts`).
- Language detection by stop words is crude; undetected text passes, so the risk is only a wrong
  `language` rejection for mixed-language posts. Reversal: drop the rule.
- Scores are computed with the profile at analysis time; a later profile change does not rescore
  ([FOLLOW-UP] rescore on profile save — the scoring is pure, so it is a loop over `analyses`).
- System moves to `REJECTED`/`NEEDS_VERIFICATION` leave no activity event until S-08 (D-17);
  S-08's plan should backfill or accept that history starts with S-08.
- The 10-minute timer (D-4) is a stand-in for S-12; S-12's plan must replace it with its job and
  lock, or two drains could overlap across processes (`pnpm discover`).
- `SKIPPED` is a fourth `AnalysisStatus` beyond brief §10.1's three; S-06/S-13 must render it.
- e2e flakiness: analysis runs after the import response; the e2e reloads until the analysed
  state appears (bounded by Playwright's timeout).
- The tech-stack sentence that the provider defaults to `mock` without a key (D-10) disagrees with
  FR-08 AC5; the PR should confirm D-10 and then the tech-stack line is corrected.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Analysis contracts and the scoring rubric
- [x] Phase 2: Pre-filter, output guard and mock provider
- [x] Phase 3: Storage, runner and configuration
- [x] Phase 4: Status route, DTOs and list filters
- [ ] Phase 5: Web views, e2e and README

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] (Phase 1) plan-review #1: `SKIPPED` added to `AnalysisStatus` in Phase 1 (not Phase 4), with the placeholder label `analysisSkipped` in `strings.pl.ts` and the list falling through to it, so no later phase can break response serialization.
- [REVIEW] (Phase 1) plan-review #7: profitability scores only a budget stated by the source; a model-proposed price (hypothesis) is neutral 5, because judging it against the profile's own rates is circular. The plan's Rubric row said "sourceBudget else proposedPrice"; `docs/scoring.md` states the new rule. Alternative: score the proposed price too (every budget-less mock result with rates would get 15/15).
- [minor] (Phase 1) plan-review #9: `confidenceFor` takes only `ANALYSED` results; `INSUFFICIENT_DATA` rows get no score and no confidence (both stay null), decided in Phase 3.

- [minor] (Phase 2) plan-review #5: the evidence guard's category rule is independent of the evidence level (`DIRECT_GIG`/`B2B_SUBCONTRACT` without a hiring/payment cue become `UNMET_NEED` whatever the level); tested in `output-guard.test.ts`.
- [minor] (Phase 2) plan-review #6: `too_old` and `no_profile_match` cannot fire for manual imports (reachable from S-10 sources). Added a small rule table in `prefilter.test.ts` (TR-25 allows `none`, does not require it) covering every rule reachable now, so `prefilter.ts` has fewer mutation survivors; `no_profile_match` has no test because `SourceType` has only manual values.
- [minor] (Phase 2) Added `mock.test.ts` and `warsaw-day.test.ts` (plan said the mock is proved end to end in Phase 3); both are cheap and pin D-15 and the DST cases early.
- [minor] (Phase 2) `ports.ts` also defines the repository record types (`CompletedAnalysis`, `FailedAnalysis`, `PendingOpportunity`, `WaitingOpportunity`); Phase 3 may adjust their shape when the SQLite repository is written.
- [minor] (Phase 3) plan-review #2: the e2e import test now waits (reload until `Analiza: gotowa`) and no longer asserts "brak analizy — w kolejce" on the detail: the 44-character DEMO post is `INSUFFICIENT_DATA` with the mock, so the detail has no analysis summary until Phase 5 renders `latestAnalysis`. Phase 5 replaces these assertions.
- [minor] (Phase 3) plan-review #3/#4: `drain()` and `kick()` share one in-flight promise (a call during a drain makes it run once more); any error after the provider answered is stored as `FAILED` with `internal_error: …`, and if that also throws the drain stops and `onError` logs it. `buildTestApp` kicks only with `autoKick: true`; tests call `runner.drain()`.
- [minor] (Phase 3) `AnalysisRepository.savePrefilter` takes a fourth argument `moveTo` (business status applied only while `NEW`), so the status mapping (D-5) stays in the service, not in SQL. Amount columns hold `sourceBudget` only (plan-review #8); `workMode UNKNOWN` is stored as null so the filters treat it as unknown.
- [minor] (Phase 3) `pnpm docker:build` fails in this sandbox before reaching the code: corepack cannot download pnpm inside the build ("self-signed certificate in certificate chain", the agent proxy's CA is not trusted in the container). Not caused by this phase; `/review` runs it again.
- [minor] (Phase 4) Plan says `opportunities.ts` imports the analysis schemas; `analysis.ts` already imported `Category`/`Confidence`/`EvidenceLevel` from `opportunities.ts`, which would be an import cycle. Moved those three enums to `classification.ts` (re-exported from `opportunities.ts`, public imports unchanged).
- [minor] (Phase 4) `OpportunityDeps` gained `clock` (for `maxAgeDays`), `AppDeps` gained `analysis` (the runner's `status()`), and `AnalysisRunner` gained `status()`; `GET /api/analysis/status` has no service of its own. `maxAgeDays` uses `coalesce(published_at, fetched_at)`; a currency different from the stored amount's is treated as unknown (plan-review #8). `minAmount` is in minor units of `currency`. `PrefilterOutcome` and `LatestAnalysis` are exported from contracts.
- [minor] (Phase 4) `analysis.demo` is derived from `analysis_provider === 'mock'`; a row whose analysis columns were set without a provider (test fixtures) reads `demo: false`.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
