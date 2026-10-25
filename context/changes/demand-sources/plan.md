# Plan: demand-sources (S-17)

## Goal and end state
Ready-made sources bring requests for work, not job ads, and every source can drop obvious noise
before any pre-filter or LLM cost, with a filter the operator switches on and off per source.
When done:

- The Sources view offers only demand-only presets: HN "Seeking freelancer", one Freelancer.com
  project feed per skill (Node.js, React, TypeScript, Arduino, Raspberry Pi, IoT, 3D printing,
  PCB layout, AI/automation) and the Arduino Forum "Jobs and Paid Consultancy" category. WWR and
  `hnrss.org/jobs?q=contract` are no longer offered. A source created from them earlier keeps
  working and is marked "preset wycofany". Any other RSS/Atom URL can still be added by hand.
  (FR-04 AC2, revised)
- An item from any feed shows its source name and links to the original URL. (FR-04 AC6,
  revised)
- Each source has include and exclude phrases and an on/off switch. When discovery runs with the
  filter on, a new item that contains an exclude phrase, or none of the include phrases, is
  stored as `REJECTED` with reason "filtr źródła: <phrase>" or "filtr źródła: brak frazy". It is
  never pre-filtered or analysed. With the filter off, the same item goes to FR-07, and switching
  the filter off keeps the phrases. (FR-31 AC1, AC2)
- A run result, the job-run history and the Sources view show how many items the source filter
  rejected. (FR-31 AC3)
- `docs/source-policy.md` has an entry for every new preset and marks the withdrawn ones.

## Scope
- In: preset list (new and withdrawn); per-source filter (storage, API, matching at discovery,
  counts); reason text in the list, card and history; Sources view editor; synthetic fixtures for
  the new feed shapes; `docs/source-policy.md`.
- Out: public tenders (S-18), code bounties (S-19), e-mail portals (S-11), Reddit (Later). An
  elektroda.pl preset is left out too (D-10). Filtering is not re-applied to signals already
  stored. There is no per-source "last run" panel (D-14).

## Findings
- **Base branch.** `change/demand-sources` was cut from local `main` at `e27f4a4`. The roadmap
  item, FR-31…FR-33 and D-15 live in `de8127f` ("docs(roadmap): demand-only sources S-17…S-19"),
  which is on `origin/main` and `docs/demand-sources` but not on this branch. The guard hook
  refuses a merge on the change branch, so this plan reads the item from `git show de8127f`. See
  *Deviations*.
- **Presets** are a static list in `apps/api/src/modules/sources/presets.ts:7-37` (`SourcePreset`:
  id, name, url, accessNote, termsUrl). `toSource` looks up the preset by `presetId` for the
  access note (`apps/api/src/modules/sources/service.ts:94-122`). If the preset is simply
  deleted, an existing WWR source falls back to `MANUAL_ACCESS_NOTE`. So withdrawn presets need to
  stay known (D-7).
- **Source config** is adapter-owned JSON (`sources.config_json`, `RssConfig` = `{ url }`,
  strict; `packages/contracts/src/sources.ts:27`). `config_key` = canonical feed URL, unique
  (`apps/api/src/infrastructure/db/schema.ts:42-62`). `canonicalizeUrl` keeps non-tracking query
  parameters, so `rss.xml?keyword=a` and `?keyword=b` are distinct sources.
- **PATCH `/api/sources/:id`** accepts only `{ enabled }` (`UpdateSourceRequest`, strict;
  `routes.ts:78-92`).
- **Run loop:** `service.run` validates config, calls `adapter.discover`, skips cursor-seen keys,
  calls `ingest` in `signals.transaction` per item, then saves the cursor and finishes the run
  (`service.ts:166-252`). `ingest` returns `created` or `duplicate`
  (`apps/api/src/modules/signals/ingest.ts:38-108`). The filter hooks in here (D-4).
- **Pre-filter storage:** `analysis-repository.ts:79-98` `savePrefilter` sets `prefilter_rule`,
  `prefilter_matches`, `prefilter_at`, `language`, `analysis_status = 'SKIPPED'`, moves `NEW` →
  `REJECTED`, and writes a system `STATUS_CHANGE` event with `ActivityCause`
  `{ kind: 'prefilter', rule }`. `pendingWithoutPrefilter` takes only `PENDING` rows with
  `prefilter_at IS NULL` (`:73-78`). `requeue` refuses rows whose `prefilter_rule` is set
  (`:176-190`). A row stored the same way can therefore never reach the LLM, which is FR-31 AC1's
  "not analysed".
- **Live counters:** `JobCounters.rejected` is computed from `opportunities.prefilter_rule` over
  the run's signals (`job-run-repository.ts:170-200`). The Sources view renders every key of
  `run.counters` with a label from `strings.jobs.counters` (`SourcesPage.tsx:248-251`,
  `strings.pl.ts:110-118`), so a new counter appears with one label.
- **Reason display:** the list and the card format the rule through `strings.prefilterRules`
  (`OpportunitiesPage.tsx:378-379`, `opportunityCard.ts:72-76`), and history through
  `strings.opportunities.history.prefilter` (`strings.pl.ts:430`).
- **Source name on the card** is already generic for every feed (`SourceFacts.name`, S-10 D-19;
  `opportunityCard.ts:145-147`), so FR-04 AC6 needs a test, not new code.
- **Tests pinned to withdrawn presets:** every call site must move to a current preset, and a
  new assertion must cover the withdrawn case (no assertion is weakened, and none of these tests
  switches to asserting the 400):
  - `apps/api/test/sources.int.test.ts`: `wwr-programming` at `:86`, `:91`, `:110`, `:124`,
    `:171`, `:207`, `:277`, `:307`; `wwr-full-stack` at `:188`, `:212`; `hn-jobs-contract` at
    `:211`, `:266`; `wwr-devops` in the offered-list assertion at `:108`.
  - `apps/api/test/jobs.int.test.ts`: `wwr-programming` at `:103`, `:369`, `:520`, `:578`.
  - Both files serve `synthetic-wwr-programming.xml` (`WWR_FEED`, `sources.int.test.ts:10`,
    `jobs.int.test.ts:18`) through MockAgent. The fixture stays (it is a valid RSS shape and
    S-10 tests parse it); only the preset id and intercepted URL change.
- **Serialisation of response schemas:** `fastify-type-provider-zod@7.0.0` serialises with
  `safeEncode(schema, data)` (`dist/esm/core.js:114-120`). In Zod 4.6.7 a `.transform()` anywhere
  in a response schema throws `$ZodEncodeError: Encountered unidirectional transform during
  encode`, so the route answers 500. `z.string().trim()` and `.refine()` encode fine
  (plan-review #1, reproduced there). So no schema reachable from a response (`Source`,
  `SourcePreset`, `SourceFilter`) may use `.transform()` (D-16).
- **System-move helpers** `moveFromNew`, `statusOf`, `recordSystemMove` and the `Tx` type are
  module-private in `apps/api/src/infrastructure/db/analysis-repository.ts:29-60`. The
  source-filter rejection needs the same event shape.
- **Text bound:** feed text is cut to `maxTextChars` in `parseFeed`
  (`apps/api/src/infrastructure/sources/rss/parse-feed.ts:172`), which `compose.ts:58` sets from
  `config.importMaxTextChars` (default `DEFAULT_IMPORT_MAX_TEXT_CHARS = 20_000`,
  `packages/contracts/src/opportunities.ts:9`).
- **Fixtures:** `parse-feed.test.ts:160-170` already runs `it.each` over every non-`synthetic-`
  file in `test/fixtures/feeds/` (S-10 D-14), so fixtures recorded in the human check join the
  suite without code changes.
- **External, `UNVERIFIED`:** the sandbox proxy refuses `www.freelancer.com`, `forum.arduino.cc`
  and `www.elektroda.pl` (HTTP 403 on CONNECT, also via WebFetch), so feed shape and robots.txt
  could not be checked.
  - Freelancer.com: public write-ups mention the site-wide `https://www.freelancer.com/rss.xml`
    and a `?keyword=` query (an n8n workflow template, a Habr Q&A thread). No official per-skill
    path was found.
  - Arduino Forum runs Discourse, and the category is `https://forum.arduino.cc/c/community/jobs/42`.
    Discourse serves category feeds at `<category URL>.rss` (standard Discourse behaviour, not
    confirmed for this forum).
  - At run time every hop is checked against robots.txt (S-09), so a disallowed feed fails
    explicitly with `robots_disallowed` and is never fetched.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Where the per-source filter is stored | New nullable column `sources.filter_json` (`SourceFilter` JSON). `NULL` reads as `{ enabled: false, include: [], exclude: [] }` | B: inside `config_json` (no migration, but that JSON is adapter-owned and strict, and the S-18/S-19 adapters would each need to carry it); C: a `source_filters` table (normalised, but one row per source adds a join for no query need) | The filter is adapter-independent (S-18 reuses it). Additive and nullable, in one column | costly (data shape) | agent |
| D-2 | Filter shape and limits | `SourceFilter = { enabled: boolean, include: string[], exclude: string[] }`, strict. Each list holds ≤ 30 phrases of 1–100 chars after `trim()`; a list with a case-insensitive duplicate is rejected (D-16). Validated with Zod in the service before it is stored (lesson: validate before storing) | B: one combined list with `+`/`-` prefixes (shorter, but easy to mistype); C: unlimited lists (no reason to; lesson: bound CPU on input) | Mirrors FR-31 wording directly. Small bounded loops | costly (API contract) | agent |
| D-3 | How a phrase matches | Case-insensitive substring. Both sides are normalised with NFKC, `toLowerCase()` and whitespace runs collapsed to one space. Text = `title + "\n" + snippet`. Diacritics are kept. Exclude is checked first, and the first configured exclude phrase that matches is the reason. Otherwise, a non-empty include list with no match gives "brak frazy". An enabled filter with both lists empty passes everything | B: whole-word match (stops `react` matching `reactive`, but breaks `[FOR HIRE]` and Polish inflections); C: regular expressions (powerful, but ReDoS on a single process; lesson on CPU-bound steps) | Predictable for the operator and linear time. Swappable inside one pure function | cheap | agent |
| D-4 | When and to what the filter applies | In `service.run`, per item that is not already in the cursor. The verdict is computed before `ingest`, and the rejection is applied **only when `ingest` creates a new opportunity**, in the same transaction. A duplicate (an existing or manually imported opportunity) is never re-rejected. The filter as stored at run time applies. Edits do not touch signals already stored | B: in the analysis pre-filter stage (state at pre-filter time, but AC3's counts are not known when the run ends, and S-18 non-RSS sources must still pass through it); C: drop filtered items without storing (cheaper, but AC1 requires "stored as rejected", and it would turn noise into silent "no results") | Meets AC1 and AC3 at discovery time, and never overrides an operator's earlier import | cheap | agent |
| D-5 | How a source-filter rejection is stored | `PrefilterRule` gains `source_filter`. New nullable column `opportunities.prefilter_phrase` (the matched exclude phrase; `NULL` = "brak frazy"). The row gets `prefilter_rule = 'source_filter'`, `prefilter_matches = 0`, `prefilter_at = now`, `analysis_status = 'SKIPPED'`, `business_status = 'REJECTED'`, plus a system `STATUS_CHANGE` event `NEW → REJECTED` with a new `ActivityCause` variant `{ kind: 'source_filter', phrase: string \| null }`. `PrefilterOutcome` gains `phrase: string \| null` | B: separate `source_filter_*` columns (leaves the pre-filter untouched, but the queue, requeue guard, live `rejected` count, list and card would each need a second check); C: a free-text reason column (unstructured; the UI could not localise it) | Reuses every existing guard: not queued, not requeueable, counted as rejected. One enum value and one column | costly (data shape, API contract) | agent |
| D-6 | How filtered items are counted (AC3) | `SourceRunResult` gains `filtered`. Filtered items still count in `new` (they are new stored signals) and in the live `rejected`. `JobCounters` gains `sourceFiltered`, read live as `prefilter_rule = 'source_filter'` over the run's signals. `pnpm discover` prints it | B: a stored `job_runs.filtered` column (frozen, but another migration and a second source of truth); C: a bucket separate from `new` (`fetched = new + dup + failed + filtered`; arguably clearer, but changes the meaning of `new` for every existing reader) | Additive; no existing counter changes meaning | costly (API contract) | agent |
| D-7 | Mechanism for withdrawn presets | `presets.ts` exports `PRESETS` (offered) and `WITHDRAWN_PRESETS` (WWR ×4, `hn-jobs-contract`), and both are used to look up access notes. `Source` gains `presetWithdrawn: boolean`. `POST /api/sources { preset: <withdrawn> }` answers 400 `unknown_preset`. Existing rows are not changed (roadmap) | B: delete the presets (existing sources would lose their access note and terms link, FR-04 AC7); C: keep them offered behind a "legacy" flag (contradicts AC2) | Keeps AC7 for old rows. One file for the lists; the response field is additive | costly (API contract: new `Source` field, and a previously valid `POST` body now answers 400) | agent |
| D-8 | Filter defaults for new and existing sources | A source created from a preset copies the preset's `filter` (enabled iff it has phrases). A hand-added feed starts with `filter_json = NULL` (off, empty). Existing rows are **not** backfilled, including existing `hn-freelance` sources | B: a migration that writes the HN default into existing HN rows (operator benefit, but it silently rewrites operator data); C: presets ship filters switched off (safer, but the roadmap calls them "sensible defaults") | Never changes what the operator already has, and the operator can add the phrase in two clicks | cheap | agent |
| D-9 | Freelancer.com feed URL form | `https://www.freelancer.com/rss.xml?keyword=<k>` with `k` ∈ `nodejs`, `react`, `typescript`, `arduino`, `raspberry pi`, `iot`, `3d printing`, `pcb layout`, `ai automation` (URL-encoded), ids `freelancer-<slug>`, terms `https://www.freelancer.com/about/terms`. `UNVERIFIED`; corrected in `presets.ts` only | B: `/rss/job_<Skill>.xml` per-skill paths (no source found for them); C: one site-wide feed plus the include filter (one request, but most items would be noise and filtered out) | The only form public sources mention. Runtime robots.txt check makes a wrong guess fail loudly, not silently. If the parameter is ignored, all nine sources would fetch the same feed and succeed; human check 1 compares two presets' samples and, if they match, switches to C in `presets.ts` | costly (third party: new host the app calls, though only for presets the operator adds) | research |
| D-10 | elektroda.pl "Projektowanie Bazar" | No preset in this change, logged as `[FOLLOW-UP]` | B: add `UNVERIFIED` preset (the roadmap says add it only "if a permitted feed exists", which nobody could confirm) | Roadmap rule; permitted access first (CLAUDE.md) | cheap | agent |
| D-11 | Arduino Forum preset | `https://forum.arduino.cc/c/community/jobs/42.rss`, id `arduino-jobs`, terms `https://www.arduino.cc/en/terms-conditions`, default filter exclude `[FOR HIRE]`, `looking for work` (roadmap). `UNVERIFIED` | B: the Discourse JSON API (`/c/…/42.json`; richer, but a new adapter type for one source) | Reuses the RSS adapter | costly (third party: new host the app calls, though only for a preset the operator adds) | research |
| D-12 | Fixtures for feeds the agent cannot reach | `synthetic-freelancer.xml` (RSS 2.0, a budget line in the description) and `synthetic-discourse.xml` (Discourse category RSS: CDATA HTML excerpt, `dc:creator`, topic guid), marked `DEMO`. Recorded files from the human check join `it.each` automatically (S-10 D-14) | B: wait for recordings (blocks the run); C: "real-looking" hand-written files (passes fiction off as recordings) | Truth first, same as S-10 | cheap | agent |
| D-13 | API for editing the filter | `PATCH /api/sources/:id` body becomes `{ enabled?: boolean, filter?: SourceFilter }`, strict, at least one key. `filter` replaces the whole filter. The response is `Source`, which now carries `filter` | B: a new `PUT /api/sources/:id/filter` route (cleaner separation, but a new route, an OpenAPI entry and a second client call); C: separate `/filter/enable` toggle routes (more surface) | Additive change to an existing route; the old `{ enabled }` body still works | costly (API contract) | agent |
| D-14 | Sources view UX for the filter | Inside each source item, a "Filtr źródła" block: a checkbox (saves at once and keeps the phrases), two textareas "Odrzucaj, gdy zawiera" and "Wymagaj jednej z fraz" (one phrase per line), and a "Zapisz filtr" button. The count appears in the run message ("odrzucone przez filtr źródła N") and as the `sourceFiltered` counter in the job history already in this view. Withdrawn presets show the badge "preset wycofany" | B: a separate filter page (more navigation); C: a per-source "last run" panel (nice, but job history already shows it per source) | Smallest UI that meets AC3. Local to `SourcesPage.tsx` | cheap | agent |
| D-15 | Reason wording | "filtr źródła: <phrase>" and "filtr źródła: brak frazy", exactly as FR-31. The list shows `Analiza: pominięta — filtr źródła: …`, and history shows the same reason. Formatted in one helper `prefilterReason()` in `apps/web/src/opportunityCard.ts` | - | Fixed by the PRD | costly (AC wording) | prd |
| D-16 | Duplicates and blank lines in a filter, given that response schemas cannot transform (plan-review #1) | One `SourceFilter` schema, used for the PATCH body, `SourcePreset` and `Source`, with no `.transform()`: phrases `z.string().trim().min(1).max(100)`, lists `.max(30)` and a `.refine()` that rejects a case-insensitive duplicate (400 `validation_failed`, path `filter.include`). The web editor splits lines, trims, drops empty lines and dedupes before it sends, so the operator never sees that 400 from the UI | B: dedupe in the service before `SourceFilter.parse` (forgiving API, but the stored value then differs from the request silently); C: `SourceFilterInput` with a transform for the body plus a plain `SourceFilter` for responses (forgiving and explicit, but two schemas to keep in step) | One schema, encodes in responses, and the API never rewrites what it was sent. Loosening to B or C later is additive | costly (API contract) | agent |
| D-17 | Where the shared system-move helpers live (plan-review #5) | New `apps/api/src/infrastructure/db/system-move.ts` exports `Tx`, `moveFromNew`, `statusOf`, `recordSystemMove`, moved verbatim from `analysis-repository.ts`, which imports them. `signal-repository.ts` uses the same functions | B: copy them into `signal-repository.ts` (no move, but the two rejection paths' event shapes can drift); C: call the analysis repository from the signal repository (couples two repositories inside one transaction) | One definition of the event shape. Pure move, covered by the existing analysis tests | cheap | agent |
| D-18 | A stored filter that fails validation (plan-review #8) | `readFilter` returns off and empty, and the run logs `source_filter_invalid` with the source id. Unit-tested for `NULL`, invalid JSON and JSON that fails the schema. Not shown in the UI | B: fail the run with an explicit error (louder, but one bad row would stop a source that otherwise works); C: a `filterInvalid` flag on `Source` (visible, but another API field for a state that validate-before-store makes unreachable except by hand-editing the DB) | Only a hand-edited DB can reach it; the log names it | cheap | agent |

## Design

### Contracts (`packages/contracts/src/sources.ts`, `analysis.ts`, `opportunities.ts`, `jobs.ts`)
- `SourceFilter` (D-2, D-16): `{ enabled, include, exclude }`, strict; phrases trimmed, 1–100
  chars, ≤ 30 per list; a `.refine()` rejects case-insensitive duplicates. No `.transform()`
  anywhere, because `Source` and `SourcePreset` are response schemas.
- `SourcePreset` += `filter: SourceFilter`.
- `Source` += `filter: SourceFilter`, `presetWithdrawn: boolean`.
- `UpdateSourceRequest` = `{ enabled?: boolean, filter?: SourceFilter }`, strict, refined to at
  least one key (D-13).
- `SourceRunResult` += `filtered: count` (D-6).
- `PrefilterRule` += `'source_filter'`; `PrefilterOutcome` += `phrase: string | null` (D-5).
- `ActivityCause` += `{ kind: 'source_filter', phrase: string | null }`.
- `JobCounters` += `sourceFiltered` (D-6).

### Schema (Drizzle, migrations generated with `pnpm --filter @lead-hunter/api db:generate`)
- Phase 1: `sources.filter_json text NULL`.
- Phase 2: `opportunities.prefilter_phrase text NULL`.

### Matching (`apps/api/src/modules/sources/source-filter.ts`, pure)
```ts
export type FilterVerdict = { pass: true } | { pass: false; phrase: string | null };
export function applySourceFilter(filter: SourceFilter, title: string, snippet: string): FilterVerdict;
export function readFilter(json: string | null): SourceFilter; // NULL/invalid → off, empty
```
Normalisation: `s.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()`. The verdict
reports the phrase as the operator typed it.

### Data flow of a run (changes to `service.run`)
1. `const filter = readFilter(record.filterJson)`. A stored value that is not valid reads as off
   and logs `source_filter_invalid` (source id only, D-18).
2. For each item not in the cursor: `verdict = filter.enabled ? applySourceFilter(...) : pass`.
3. Inside `signals.transaction`: `ingest(...)`. If the result is `created` and the verdict
   rejects, call `tx.rejectBySourceFilter(opportunityId, verdict.phrase, at)`, then
   `counts.filtered += 1`.
4. `onSignalCreated` fires only if `counts.new > counts.filtered`.
5. `finishRun` stores counts as before. `filtered` is returned in `SourceRunResult` and logged
   (counts only, FR-24 AC2).

`SignalTx.rejectBySourceFilter(opportunityId, phrase, at)` (implemented in
`signal-repository.ts`) updates the opportunity as in D-5 and inserts the system event through
`statusOf`, `moveFromNew` and `recordSystemMove` from `db/system-move.ts` (D-17), the same
functions `savePrefilter` uses. Both happen in the caller's transaction, so an item is never
left `PENDING` half-filtered.

### Error model
- Bad filter in PATCH (too long, too many, empty after trim, duplicate): 400
  `validation_failed` with field paths (`filter.include.3`, `filter.include`, …).
- Unknown or withdrawn preset: 400 `unknown_preset`.
- Matching cannot fail. Text is already bounded by `config.importMaxTextChars` (passed to
  `parseFeed` as `maxTextChars`), and phrases by D-2.

## Phases

### Phase 1: Demand-only presets and filter configuration
- Files:
  - `packages/contracts/src/sources.ts`: `SourceFilter`, `SourcePreset.filter`, `Source.filter`,
    `Source.presetWithdrawn`, new `UpdateSourceRequest`. Contract: D-2, D-7, D-13.
  - `apps/api/src/infrastructure/db/schema.ts` and `apps/api/migrations/0010_*.sql` (generated):
    `sources.filter_json`. Contract: D-1.
  - `apps/api/src/modules/sources/presets.ts`: new `PRESETS` (hn-freelance with include
    `SEEKING FREELANCER`; nine `freelancer-*` with no phrases; `arduino-jobs` with two excludes)
    and `WITHDRAWN_PRESETS`. Polish access notes. Contract: D-7, D-8, D-9, D-11.
  - `apps/api/src/modules/sources/source-filter.ts` (new): `readFilter` (and the normalisation
    helper used in Phase 2). Contract: `readFilter(json | null): SourceFilter` (D-18).
    `source-filter.test.ts` (new): `readFilter` on `NULL`, a valid value, invalid JSON and JSON
    that fails the schema; every entry of `PRESETS` and `WITHDRAWN_PRESETS` has a filter that
    `SourceFilter.parse` accepts.
  - `apps/api/src/modules/sources/ports.ts`, `service.ts`: `SourceRecord.filterJson`,
    `NewSource.filterJson`. `create` copies the preset filter. `setEnabled` becomes
    `update(id, { enabled?, filter? })`, which validates with `SourceFilter` before storing.
    `toSource` adds `filter` and `presetWithdrawn`. Contract: `SourceService.update`.
  - `apps/api/src/infrastructure/db/source-repository.ts`: read and write `filter_json`;
    `update(id, patch, at)`.
  - `apps/api/src/modules/sources/routes.ts`: PATCH uses the new body and service call.
    Validation errors map to `validation_failed`.
  - `apps/web/src/api/sources.ts`: types follow (no UI change yet, so the build stays green).
  - `packages/contracts/src/sources.test.ts` (new or extended, following the existing contracts
    tests): `SourceFilter` rejects a case-insensitive duplicate, a 101-char phrase, 31 phrases
    and a blank phrase, trims accepted phrases, and `z.encode(Source, value)` with a filter set
    does not throw (guards D-16).
  - `apps/api/test/fixtures/feeds/synthetic-freelancer.xml`,
    `apps/api/test/fixtures/feeds/synthetic-discourse.xml` (new, `DEMO`), and
    `apps/api/src/infrastructure/sources/rss/parse-feed.test.ts`: parse both shapes (title, link,
    date, text with the budget line kept as source text, CDATA HTML stripped). Contract: D-12.
  - `apps/api/test/sources.int.test.ts`, `apps/api/test/jobs.int.test.ts`: move every call site
    listed in *Findings* (`wwr-*`, `hn-jobs-contract`) to a current preset (`freelancer-*`,
    `arduino-jobs`, `hn-freelance`) with equal-strength assertions and the matching MockAgent
    URL. New tests:
    - presets offered = new list, no WWR or `jobs?q=contract`;
    - `{ preset: 'wwr-programming' }` → 400;
    - a row inserted with `preset_id = 'wwr-programming'` lists with `presetWithdrawn: true` and
      its WWR access note;
    - creating from `hn-freelance` / `arduino-jobs` stores the preset filter;
    - PATCH filter round-trips, off keeps the phrases, over-limit / empty / duplicate phrase →
      400 `validation_failed`, and `{ enabled }` alone still works;
    - after a PATCH that sets a filter, `GET /api/sources` and `POST /api/sources` (preset with a
      filter) answer 200 with that filter in the body (guards D-16 at the serialiser).
- Proves: FR-04 AC2 (integration), FR-04 AC7 for withdrawn rows (integration), the D-2
  validation (integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none (the real-feed check is in Phase 3).

### Phase 2: Filter at discovery and visible counts
- Files:
  - `packages/contracts/src/analysis.ts`: `PrefilterRule` += `source_filter`.
    `packages/contracts/src/opportunities.ts`: `PrefilterOutcome.phrase`, `ActivityCause`
    variant. `packages/contracts/src/sources.ts`: `SourceRunResult.filtered`.
    `packages/contracts/src/jobs.ts`: `JobCounters.sourceFiltered`. Contract: D-5, D-6.
  - `apps/api/src/infrastructure/db/schema.ts` and `apps/api/migrations/0011_*.sql`
    (generated): `opportunities.prefilter_phrase`.
  - `apps/api/src/modules/sources/source-filter.ts`: `applySourceFilter` (D-3).
    `source-filter.test.ts` (new): table-driven cases:
    - case and whitespace insensitivity, diacritics kept (`łódź` ≠ `lodz`);
    - exclude beats include, first exclude in configured order wins;
    - empty include passes, include miss → `phrase: null`;
    - bracketed phrase `[FOR HIRE]`, a phrase in title only and in snippet only;
    - a maximum-size text (`DEFAULT_IMPORT_MAX_TEXT_CHARS` characters) with 30 + 30 phrases of
      100 chars finishes under 50 ms (lesson on CPU bounds).
  - `apps/api/src/infrastructure/db/system-move.ts` (new) and `analysis-repository.ts`: move
    `Tx`, `moveFromNew`, `statusOf`, `recordSystemMove` and import them back (D-17). No
    behaviour change; the existing analysis tests cover it.
  - `apps/api/src/modules/signals/ports.ts`, `apps/api/src/infrastructure/db/signal-repository.ts`:
    `SignalTx.rejectBySourceFilter(opportunityId, phrase, at)` (D-5), using `system-move.ts`.
  - `apps/api/src/modules/sources/service.ts`: run flow per *Design*; `filtered` in result and log.
  - `apps/api/src/infrastructure/db/opportunity-repository.ts`,
    `apps/api/src/modules/opportunities/ports.ts`, `apps/api/src/modules/opportunities/service.ts`:
    read `prefilter_phrase` into `PrefilterOutcome.phrase` (`null` for other rules).
  - `apps/api/src/infrastructure/db/job-run-repository.ts`: `sourceFiltered` in the grouped
    pass, summed into cycles.
  - `apps/api/src/cli/discover.ts`: prints `odrzucone przez filtr źródła N`.
  - `apps/web/src/strings.pl.ts`: `prefilterRules.source_filter`,
    `jobs.counters.sourceFiltered`, `history.sourceFilter`. These keep the typed string maps
    complete. Rendering of the phrase comes in Phase 3.
  - `apps/api/test/sources.int.test.ts`: MockAgent feed with three items under a source with
    exclude `[FOR HIRE]` and include `arduino`:
    - item 1 contains the exclude → `REJECTED`, `analysisStatus SKIPPED`, `prefilter.rule
      source_filter`, `phrase "[FOR HIRE]"`, history cause `source_filter`, and the analysis
      runner (mock provider) does not analyse it (AC1);
    - item 2 lacks the include → `phrase null` (AC2);
    - item 3 passes and is analysed;
    - run result `filtered: 2, new: 3`;
    - the same feed on a fresh source with the filter off: all three pass to FR-07 (AC2);
    - a re-read creates nothing and filters nothing (cursor);
    - an item whose URL already belongs to a manual import is a duplicate and that opportunity
      keeps its status (D-4);
    - `requeue` on a filtered row → `prefiltered`;
    - an item from a `freelancer-*` source shows `source.name` and the original `source.url` in
      `GET /api/opportunities/:id` (FR-04 AC6).
  - `apps/api/test/jobs.int.test.ts`: `counters.sourceFiltered` on the source run and its cycle
    (AC3).
- Proves: FR-31 AC1, AC2 (unit + integration), FR-31 AC3 (integration: run result, job run),
  FR-04 AC6 (integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: Sources view, reason text and source policy
- Files:
  - `apps/web/src/opportunityCard.ts`: `prefilterReason(prefilter)` returns the rule label, or
    for `source_filter` "filtr źródła: <phrase>" / "filtr źródła: brak frazy" (D-15).
    `opportunityCard.test.ts` covers both branches and an ordinary rule.
  - `apps/web/src/OpportunitiesPage.tsx`, `apps/web/src/OpportunityPage.tsx` (history row) and
    the history formatter that handles `ActivityCause`: use `prefilterReason` and the new cause
    variant.
  - `apps/web/src/SourcesPage.tsx`, `SourcesPage.module.css`, `strings.pl.ts`: filter block per
    source (D-14), badge "preset wycofany", run message with the filtered count (`runDone`
    gets a fourth argument), counter label. Works at 360 px.
  - `apps/web/src/api/sources.ts`: `updateSource(id, patch)` replaces `setSourceEnabled`.
  - `docs/source-policy.md`:
    - entries for Freelancer.com presets and the Arduino Forum preset (access, terms, limits,
      `DO WERYFIKACJI`);
    - HN `hn-jobs-contract` and WWR sections marked "wycofany (shape D-15)" (the shape-notes
      decision, not this plan's D-15);
    - a section "Filtr źródła" covering the rules of D-3/D-4 and the fact that filtered items are
      stored and counted.
  - `README.md` (section on sources, if present) and `CLAUDE.md` Commands (`pnpm discover`
    output) are touched only if they list presets or counts.
- Proves: D-15 wording (unit on `prefilterReason`). The UI direction is a human check.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, then `pnpm e2e` once (the main path
  must stay green; no new spec, test-plan budget).
- Human checks:
  1. Real run of every preset from a machine with internet: `pnpm dev`, log in, add each preset
     in the Sources view, press **Uruchom** on each (or `pnpm discover`). Record in
     `evidence/real-run.md`, per preset: status, fetched / new / odrzucone przez filtr źródła,
     and one sample signal (title, URL, date). Note any preset that fails with
     `robots_disallowed`, 404 or `invalid_feed`, so its URL is corrected in `presets.ts`.
     Compare the first five item URLs of `freelancer-nodejs` and `freelancer-arduino` and record
     whether they differ. If they are the same, `?keyword=` is ignored: D-9 switches to C (one
     `freelancer-projects` preset on `rss.xml` with the skills as include phrases).
  2. Record fixtures: `pnpm fixtures:record <id>` for one `freelancer-*` source and
     `arduino-jobs`. Review that the files hold no real names, handles or e-mails, then commit
     and run `pnpm test`.
  3. UI on phone width (360 px) and laptop: edit an exclude phrase, switch the filter off and on
     (phrases stay), run a source, and check the list and card read "filtr źródła: …". A WWR
     source added before this change shows "preset wycofany".

## Risks and unknowns
- Freelancer.com and Arduino feed URLs, item shapes and robots.txt are `UNVERIFIED` (D-9, D-11).
  A wrong URL fails explicitly at run time and is corrected in one file. Human check 1 settles
  it.
- Freelancer.com's terms may not allow automated feed reading even where robots.txt does. The
  operator confirms this in human check 1 against the terms page, and the source-policy entry
  says `DO WERYFIKACJI`.
- Substring matching can over-match (`react` in `reactive`). The phrases are the operator's own,
  and D-3 is local to one pure function.
- A filtered item claims its URL identity, so a later manual import of the same URL is a
  duplicate of a `REJECTED` opportunity. This is the same behaviour as a pre-filter rejection,
  and the operator can still move it.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Demand-only presets and filter configuration
- [x] Phase 2: Filter at discovery and visible counts
- [x] Phase 3: Sources view, reason text and source policy

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
(Phases 1 and 2 have none.)
- [ ] (Phase 3) Real run of every preset (status, fetched / new / odrzucone przez filtr źródła, one sample signal; failures `robots_disallowed`/404/`invalid_feed`; compare first five item URLs of `freelancer-nodejs` and `freelancer-arduino` — same means `?keyword=` is ignored, switch D-9 to C) — run: `pnpm dev`, log in, add each preset in Sources, press **Uruchom** (or `pnpm discover`) — evidence: `context/changes/demand-sources/evidence/real-run.md` (none yet)
- [ ] (Phase 3) Record fixtures for one `freelancer-*` source and `arduino-jobs`, check they hold no real names, handles or e-mails, commit, run `pnpm test` — run: `pnpm fixtures:record freelancer-nodejs`, `pnpm fixtures:record arduino-jobs` — evidence: none
- [ ] (Phase 3) UI at 360 px and on a laptop: edit an exclude phrase, switch the filter off and on (phrases stay), run a source, list and card read "filtr źródła: …"; a WWR source added before this change shows "preset wycofany" — run: `pnpm dev`, Sources view and Okazje — evidence: none

## Deviations
- [REVIEW] Plan says the roadmap item is resolved in `context/roadmap.md` and its status set to
  `planned`. The branch shows `change/demand-sources` was cut from local `main` (`e27f4a4`)
  without `de8127f`, which adds S-17, FR-31…FR-33 and D-15 (present on `origin/main`). The guard
  hook refuses a merge on the change branch. Consequence: the plan is built from
  `git show de8127f`. The roadmap status is not set here, because adding the S-17 row on this
  branch would duplicate `de8127f` and conflict with `main`. The PR should be rebased onto (or
  merged with) `origin/main` before merging, and the status set then. Alternative: rebase the
  branch now (refused by the run rules).
- [minor] Phase 1: plan says `readFilter(json | null): SourceFilter`; code returns
  `{ filter, invalid }` so `service.run` (Phase 2) can log `source_filter_invalid` (D-18) without
  re-parsing. Consequence: callers read `.filter`. No behaviour change.
- [minor] Phase 1: `setEnabled` became `update` on both `SourceRepository` and `SourceService`;
  the web `setSourceEnabled` became `updateSource(id, patch)` already in this phase (one call site
  in `SourcesPage.tsx`) so the build stays green. Phase 3 does not need to rename it again.
- [REVIEW] Phase 2 (plan-review R2 #1, major): the roadmap default `include: SEEKING FREELANCER` for
  `hn-freelance` never rejects, because every hnrss comment title carries the thread name. Code
  now ships `hn-freelance` with `include: []`, `exclude: ['SEEKING WORK']` (exclude is checked
  first, so it works on title+snippet). Alternative: keep the roadmap wording as is (a no-op
  filter). Existing `hn-freelance` rows are still not backfilled (D-8). Covered by one
  integration test and one jobs test.
- [REVIEW] Phase 2 (plan-review R2 #2, major): the test budget lists no TR row for the source
  filter. Kept: the table-driven unit test for `applySourceFilter`, one integration test for
  AC1–AC3 plus requeue guard and duplicate/cursor behaviour, one HN-default test and one jobs
  counter test. Dropped from the plan: the timing test (also plan-review #6), the separate
  "filter off", "manual import duplicate" and `source.name`/URL cases (the latter is already
  covered by the S-10 AC6 test).
- [minor] Phase 2: `move*` helpers in `system-move.ts` keep their original `(D-17)` comment from
  S-06; no behaviour change.
- [FOLLOW-UP] elektroda.pl "Projektowanie Bazar" preset: check from a machine with internet
  whether forum 392 has an RSS feed that robots.txt and the terms allow, and add it to
  `presets.ts` if so (D-10).

- [minor] Phase 3: `prefilterReason(rule, phrase)` takes the rule and phrase, not the whole
  `prefilter` object, because TypeScript does not narrow `prefilter.rule` through the object. The
  history row already used the `source_filter` cause since Phase 2, so no change there. README and
  CLAUDE.md list neither presets nor counts, so they are untouched.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
- #1 (blocker): no `.transform()` in `SourceFilter`; duplicates are rejected by `.refine()` and
  the web editor dedupes before sending (new D-16, D-2 and *Design* updated). Added a contracts
  test that `Source` encodes with a filter set and an integration assertion that `GET`/`POST
  /api/sources` answer 200 with a filter (Phase 1). *Findings* records the serialiser fact.
- #2 (major): D-7 marked `costly (API contract)`; D-9 and D-11 marked `costly (third party)`.
- #3: *Findings* lists every withdrawn-preset call site in both test files; Phase 1 moves all
  of them to current presets.
- #4: uses `DEFAULT_IMPORT_MAX_TEXT_CHARS` / `config.importMaxTextChars` (`maxTextChars` in
  `parseFeed`).
- #5: new D-17, `db/system-move.ts` exports the helpers, moved in Phase 2.
- #6: human check 1 compares two `freelancer-*` presets' items and names the fallback to D-9 C.
- #7: the source-policy text says "shape D-15".
- #8: new D-18 records the fail-open choice; Phase 1 adds unit tests for the invalid branches.
