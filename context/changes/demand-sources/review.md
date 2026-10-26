# Review: demand-sources

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (63 files, 896 tests), e2e ok (5/5), image not run (no Docker daemon in this environment), image smoke not run (needs the image) · Round: 1

Base: `main` (`3f6136e`), which `HEAD` (`0d647cc`, "Merge main into change/demand-sources") already
contains, so `git diff main HEAD` is the change. No `mutation.md` exists for this change.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/sources.ts` | done | `SourceFilter` (trim, 1–100, ≤ 30, dedupe `.refine()`, no transform), `SourcePreset.filter`, `Source.filter`/`presetWithdrawn`, `UpdateSourceRequest`, `SourceRunResult.filtered` |
| `packages/contracts/src/sources.test.ts` | done | rejects dup/101/31/blank/extra key, trims, `z.encode(Source)` guard |
| `packages/contracts/src/analysis.ts` | done | `PrefilterRule += source_filter` |
| `packages/contracts/src/opportunities.ts` | done | `PrefilterOutcome.phrase`, `ActivityCause` `source_filter` variant |
| `packages/contracts/src/jobs.ts` | done | `JobCounters.sourceFiltered` |
| `packages/contracts/src/index.ts` | unplanned | exports `SourceFilter`; needed |
| `apps/api/src/infrastructure/db/schema.ts` | done | `sources.filter_json`, `opportunities.prefilter_phrase` |
| `apps/api/migrations/0010_*.sql`, `0011_*.sql` | diverged | Plan: one migration per phase. After the merge with `main` (whose own 0010 is offer-drafts) both columns are in one regenerated `0011_mean_zaran.sql` (+ snapshot, journal). Additive, nullable; correct. Not logged under *Deviations* |
| `apps/api/src/modules/sources/presets.ts` | done | new `PRESETS`, `WITHDRAWN_PRESETS`; HN default is `exclude: ['SEEKING WORK']` per the `[REVIEW]` deviation |
| `apps/api/src/modules/sources/source-filter.ts` (+ test) | done | `readFilter` returns `{ filter, invalid }` (logged `[minor]`); `applySourceFilter` per D-3 |
| `apps/api/src/modules/sources/ports.ts`, `service.ts` | done | `update`, preset filter copied on create, verdict before `ingest`, rejection only on `created` in the same transaction |
| `apps/api/src/infrastructure/db/source-repository.ts` | done | `update(id, patch, at)` |
| `apps/api/src/modules/sources/routes.ts` | done | PATCH calls `service.update` |
| `apps/api/src/infrastructure/db/system-move.ts`, `analysis-repository.ts` | done | verbatim move (D-17) |
| `apps/api/src/modules/signals/ports.ts`, `infrastructure/db/signal-repository.ts` | done | `rejectBySourceFilter` per D-5 |
| `apps/api/src/infrastructure/db/opportunity-repository.ts`, `modules/opportunities/{ports,service}.ts` | done | `prefilter_phrase` → `PrefilterOutcome.phrase` |
| `apps/api/src/infrastructure/db/job-run-repository.ts` | done | `sourceFiltered` live and summed into cycles |
| `apps/api/src/cli/discover.ts` | done | prints `odrzucone przez filtr źródła N` |
| `apps/api/test/fixtures/feeds/synthetic-{freelancer,discourse}.xml`, `parse-feed.test.ts` | done | `DEMO`, both shapes parsed |
| `apps/api/test/sources.int.test.ts` | done | call sites moved; withdrawn, defaults, AC1–AC3, HN default, PATCH cases. The "filter off passes to FR-07" case is missing (R2) |
| `apps/api/test/jobs.int.test.ts` | done | call sites moved; `sourceFiltered` on run and cycle |
| `apps/web/src/opportunityCard.ts` (+ test) | done | `prefilterReason(rule, phrase)` (logged `[minor]`) |
| `apps/web/src/OpportunitiesPage.tsx`, `OpportunityPage.tsx` | done | reason in list and history |
| `apps/web/src/SourcesPage.tsx`, `SourcesPage.module.css`, `strings.pl.ts` | done | filter block, badge, run message, counter label |
| `apps/web/src/api/sources.ts` | done | `updateSource(id, patch)` |
| `docs/source-policy.md` | done | new presets, withdrawn marks, "Filtr źródła" section; one stale line (R3) |
| `README.md` | absent | Plan: touch only if it lists presets. After the merge it does (`README.md:156`, `:206`, `:220`) and still offers WWR (R3) |
| `context/changes/demand-sources/{plan,plan-review,pr-body}.md` | done | workflow artifacts |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | AC1–AC3 hold for one source, but a rejection is global to the opportunity, so overlapping sources give order-dependent results (R1) |
| Design | ok | rejection reuses `prefilter_rule` and every existing guard; helpers shared via `system-move.ts`; filter isolated in one pure module |
| Safety | ok | filter validated with Zod at the route and again before storing; bounded lists; linear substring match; no transform in response schemas; invalid stored JSON logged by source id only |
| Tests | concern | the filter-off branch of `service.run` is never exercised with phrases that would reject (R2) |
| Simplicity | ok | small diff per concern; editor stays local to `SourcesPage.tsx` |
| Plan fidelity | ok | deviations logged; migration merge and README not logged (R3) |
| Agent decisions | ok | each costly decision (D-1, D-2, D-5, D-6, D-7, D-9, D-11, D-13, D-16) lives in one schema, column or file and can be swapped as claimed |

## Findings
### R1: A source-filter rejection is global, so overlapping sources decide each other's items by run order
- Severity: major
- Where: `apps/api/src/modules/sources/service.ts:225-247`, `apps/api/src/modules/signals/ingest.ts:53-73`
- Problem: the rejection is stored on the opportunity, and identity lookup in `ingest` is global (canonical URL, then content hash, across every source). When the same item appears in two sources, whichever runs first decides: if source A has the filter on (e.g. an include list) it stores the item as `REJECTED` "filtr źródła: brak frazy"; source B, with the filter off or with phrases that pass it, then sees a duplicate and the item never reaches FR-07. If B runs first, the item is analysed. The Freelancer.com presets are nine keyword feeds of one site, so the same project is likely to show up in several of them (`nodejs`/`typescript`/`react`). The integration test shows this: `sources.int.test.ts` "stores items the source filter drops…" runs the same feed on `freelancer-react` with the filter off and asserts `new: 0, duplicates: 3`, so "DEMO Web shop" stays `REJECTED` by A's filter. Its comment says the filter-off source "passes every new item on", but nothing passes. FR-31 AC2 says "with the filter off the same item passes to FR-07". D-4 covers only one direction (a filter never re-rejects a duplicate), and *Risks* names only the manual-import case. Neither records the cross-source case or that the outcome depends on run order.
- Fix: (A, cheap now) add a *Decisions* row that accepts "first source wins" for a shared item, fix the misleading test comment, and add one sentence to `docs/source-policy.md` ("Kiedy") so the operator knows a filter on one Freelancer.com source can hide an item that another would pass. (B, more behaviour) in `service.run`, when a duplicate's existing opportunity is still in the untouched system state `REJECTED` + `prefilter_rule = 'source_filter'` and this source's verdict passes, clear the source-filter fields and move it back to `NEW`/`PENDING` with a system event. That needs a new repository method and a test. Choose B only if order independence matters more than the extra state transition.
- Effort: small (A) | medium (B)
- Lesson candidate: When a per-source rule writes to a shared, deduplicated record, decide and test what a second source that disagrees does.
- Decision: open

### R2: FR-31 AC2 "with the filter off the same item passes to FR-07" has no test, and the `enabled` check is unguarded
- Severity: major
- Where: `apps/api/src/modules/sources/service.ts:225-227`, `apps/api/test/sources.int.test.ts` (the FR-31 AC1–AC3 test)
- Problem: every discovery run in the suite either has the filter on, or has it off with empty phrase lists (`freelancer-*` presets are `off()`, and `applySourceFilter` passes everything on empty lists anyway), or hits only duplicates (the `freelancer-react` part of the AC test above). The PATCH test switches the filter off with phrases set but never runs discovery. So if the code dropped the `filter.enabled ?` condition and always applied the phrases, every test would still pass, and the second half of AC2 ("switching the filter off keeps the phrases" *and* lets items through) would break silently. The `[REVIEW]` deviation dropped the separate "filter off" case to fit the test budget, but plan-review R2 #2 asked to keep "AC1–AC3 plus filter off" in the one integration test.
- Fix: in the existing AC1–AC3 test, after the re-read, `PATCH { filter: { …, enabled: false } }` (phrases kept), advance the clock, serve one new item containing `[FOR HIRE]`, run, and assert `filtered: 0, new: 1` and that the item is `NEW`/`PENDING` with no `source_filter` rule. That is a few lines and no new test.
- Effort: small
- Lesson candidate: For every on/off switch an AC names, test the off state with input that the on state would reject.
- Decision: open

### R3: README still offers the withdrawn WWR presets, and two notes are stale
- Severity: minor
- Where: `README.md:156`, `README.md:206`, `README.md:220`; `docs/source-policy.md:40`; `context/changes/demand-sources/plan.md` *Deviations*
- Problem: after the merge with `main`, README lists "RSS: We Work Remotely" in the adapter table, says the Sources view adds "We Work Remotely: programming, full-stack, back-end, devops" in one click, and lists real WWR feeds as a human check. None of these presets is offered any more (FR-04 AC2), and the new Freelancer.com and Arduino presets and the source filter are not mentioned. The Phase 3 deviation says "README and CLAUDE.md list neither presets nor counts", which was true before the merge, but plan-review R2 #3 had already asked for an unconditional README edit. `docs/source-policy.md:40` still says "komentarze typu „SEEKING WORK" odrzuca filtr wstępny", while a new `hn-freelance` source now drops them with the source filter first. The migration merge (two planned migrations, one regenerated `0011_mean_zaran.sql`) is not logged either.
- Fix: update the README table, the *Źródła RSS/Atom* bullet and the human-check list to the S-17 presets, with one line on the source filter. In source-policy, say that the default source filter drops `SEEKING WORK` and FR-07 still catches it for older sources. Add a `[minor]` deviation for the merged migration and correct the README deviation line.
- Effort: small
- Lesson candidate: After merging the default branch into a change, re-check every "untouched because X" claim in the plan against the merged tree.
- Decision: open

### R4: The filter editor keeps showing the unnormalised draft after a save
- Severity: minor
- Where: `apps/web/src/SourcesPage.tsx:71-72`, `:124`
- Problem: the `exclude`/`include` textareas are seeded from `source.filter` only on mount (`useState(...)`). "Zapisz filtr" sends `toPhrases(...)` (trimmed, blank lines and case-insensitive duplicates dropped) and shows "Filtr zapisany.", but the textareas keep the raw text, duplicates and blank lines included. After a reload they show the stored list instead, so the operator sees two different filters for one source and is never told that a duplicate line was dropped.
- Fix: after a successful phrase save, set both drafts from the returned `Source` (`updateSource` already returns it): `setExclude(saved.filter.exclude.join('\n'))`, and the same for include. The checkbox path keeps the draft as it is (plan-review R2 #7).
- Effort: small
- Lesson candidate: no
- Decision: open
