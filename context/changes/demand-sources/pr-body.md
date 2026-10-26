# feat(demand-sources): demand-only presets and a per-source filter

Roadmap item S-17. The Sources view now offers only demand-only presets (HN "Seeking freelancer", nine Freelancer.com skill feeds, Arduino Forum "Jobs and Paid Consultancy"); WWR and `hnrss.org/jobs?q=contract` are withdrawn but keep working on existing sources, marked "preset wycofany". Every source has include/exclude phrases and an on/off switch: at discovery a new item that matches an exclude phrase, or none of the include phrases, is stored as `REJECTED` ("filtr źródła: <phrase>" / "filtr źródła: brak frazy"), never pre-filtered or analysed, and the count shows in the run result, job history and Sources view. Covers FR-04 AC2 and AC6 (revised) and FR-31 AC1–AC3.
Closes #31

> **Status:** Ready for review

## ⚠ Needs your decision
- **[REVIEW] Branch base.** The branch was cut from local `main` without `de8127f` (adds S-17, FR-31…FR-33, D-15). The plan was built from `git show de8127f`, and `main` was later merged in (`0d647cc`). The run rules forbid rebasing, so check the merge before merging the PR. Roadmap row S-17 currently reads `review`; set it to `done` when merging.
- **[REVIEW] HN default filter changed from the roadmap.** The roadmap default `include: SEEKING FREELANCER` for `hn-freelance` never rejects, because every hnrss comment title carries the thread name. Shipped as `include: []`, `exclude: ['SEEKING WORK']` instead. Alternative: keep the roadmap wording (a no-op filter). Existing `hn-freelance` rows are not backfilled (D-8). Plan-review R2 #1.
- **[REVIEW] Test budget.** No TR row names the source filter, so the plan's wider test set was cut to one table-driven unit test for `applySourceFilter`, one integration test for AC1–AC3 (plus filter-off, requeue guard, duplicate and cursor), one HN-default test and one jobs counter test. The timing test and separate cases were dropped. Plan-review R2 #2.
- **D-9 (costly, third party):** Freelancer.com URL `https://www.freelancer.com/rss.xml?keyword=<k>` (nine presets) → chose **A**. Alternatives: B: `/rss/job_<Skill>.xml` (no source found); C: one site-wide feed plus include phrases. Switching costs: `presets.ts` only. `UNVERIFIED` (sandbox could not reach the site); if `?keyword=` is ignored, human check 1 says to switch to C.
- **D-11 (costly, third party):** Arduino Forum feed `https://forum.arduino.cc/c/community/jobs/42.rss` with default exclude `[FOR HIRE]`, `looking for work` → chose **A**. Alternative: Discourse JSON API (new adapter type). Switching costs: `presets.ts`, or a new adapter. `UNVERIFIED`.
- **D-1 (costly, data shape):** filter in new column `sources.filter_json` → chose **A**. Alternatives: B: inside `config_json`; C: a `source_filters` table. Switching costs: migration `0011_mean_zaran.sql`, `source-repository.ts`, `service.ts`.
- **D-5 (costly, data shape and API):** a source-filter rejection reuses `prefilter_rule = 'source_filter'` plus `opportunities.prefilter_phrase` → chose **A**. Alternatives: B: separate `source_filter_*` columns; C: free-text reason. Switching costs: migration, `signal-repository.ts`, `opportunity-repository.ts`, list/card/history in the web app.
- **D-6 (costly, API):** `filtered` in `SourceRunResult` and `JobCounters.sourceFiltered`, filtered items still count in `new` → chose **A**. Alternatives: B: stored `job_runs.filtered` column; C: bucket separate from `new`. Switching costs: contracts, `job-run-repository.ts`, `service.ts`.
- **D-7 (costly, API):** `WITHDRAWN_PRESETS` plus `Source.presetWithdrawn`; `POST` of a withdrawn preset now answers 400 `unknown_preset` → chose **A**. Alternatives: B: delete the presets (old rows lose access note); C: keep them offered behind a flag. Switching costs: `presets.ts`, `service.ts`, contracts.
- **D-13 (costly, API):** `PATCH /api/sources/:id` takes `{ enabled?, filter? }` → chose **A**. Alternatives: B: new `PUT …/filter`; C: toggle routes. Switching costs: `routes.ts`, `apps/web/src/api/sources.ts`.
- **D-16 (costly, API):** one `SourceFilter` schema, no `.transform()` (it breaks response encoding), duplicates rejected with 400 → chose **A**. Alternatives: B: dedupe in the service silently; C: separate input schema with a transform. Switching costs: `packages/contracts/src/sources.ts`, web editor.
- **D-15 (prd):** wording "filtr źródła: <phrase>" / "filtr źródła: brak frazy" is fixed by FR-31.
- **D-19 (review R1):** the same item in two sources is decided by whichever source stores it first (a later source sees a duplicate). Documented in `docs/source-policy.md`. Alternative B: move an untouched `source_filter` rejection back to `NEW`/`PENDING` when a later source passes it (order independent; needs a repository method and a state transition). Matters for the nine overlapping Freelancer.com feeds.

Reply in a review comment, e.g. `D-3: take B`, `D-19: take B`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 3) Real run of every preset: status, fetched / new / odrzucone przez filtr źródła, one sample signal; note `robots_disallowed`, 404 or `invalid_feed`. Compare the first five item URLs of `freelancer-nodejs` and `freelancer-arduino`; if identical, `?keyword=` is ignored and D-9 switches to C. Run: `pnpm dev`, log in, add each preset in Sources, press **Uruchom** (or `pnpm discover`). Evidence: `context/changes/demand-sources/evidence/real-run.md` (none yet).
- [ ] (Phase 3) Record fixtures for one `freelancer-*` source and `arduino-jobs`, check they hold no real names, handles or e-mails, commit, run `pnpm test`. Run: `pnpm fixtures:record freelancer-nodejs`, `pnpm fixtures:record arduino-jobs`. Evidence: none.
- [ ] (Phase 3) UI at 360 px and on a laptop: edit an exclude phrase, switch the filter off and on (phrases stay), run a source, list and card read "filtr źródła: …"; a WWR source added before this change shows "preset wycofany". Run: `pnpm dev`, Sources view and Okazje. Evidence: none.
- [ ] Freelancer.com terms may not allow automated feed reading even where robots.txt does; confirm against the terms page (`docs/source-policy.md` says `DO WERYFIKACJI`).

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | Filter shape and limits | `{ enabled, include, exclude }`, ≤ 30 phrases of 1–100 chars, no case-insensitive duplicates | B: one list with `+`/`-` prefixes; C: unlimited lists |
| D-3 | How a phrase matches | Case-insensitive substring (NFKC, whitespace collapsed, diacritics kept) over title + snippet; exclude first | B: whole-word; C: regular expressions |
| D-4 | When the filter applies | At discovery, per non-cursor item, rejecting only when `ingest` creates the opportunity | B: in the analysis pre-filter; C: drop without storing |
| D-8 | Filter defaults | New preset sources copy the preset filter; hand-added start off; no backfill | B: backfill HN rows; C: presets ship filters off |
| D-10 | elektroda.pl preset | None (no confirmed permitted feed) | B: add an `UNVERIFIED` preset |
| D-12 | Fixtures for unreachable feeds | `synthetic-freelancer.xml`, `synthetic-discourse.xml`, marked `DEMO` | B: wait for recordings; C: hand-written "real" files |
| D-14 | Sources view UX | "Filtr źródła" block per source; "preset wycofany" badge; count in run message and job history | B: separate page; C: per-source last-run panel |
| D-17 | Shared system-move helpers | New `db/system-move.ts`, moved verbatim | B: copy; C: call the analysis repository |
| D-18 | Stored filter fails validation | Reads as off, run logs `source_filter_invalid` with the source id | B: fail the run; C: `filterInvalid` flag on `Source` |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (896 tests), e2e ok (5/5); image and image smoke **not run** (no Docker daemon in the review environment).
- Review: APPROVE, round 2 (round 1: APPROVE WITH FOLLOW-UPS, 4 findings): fixed 4 (R1 first-source-wins documented as D-19, R2 filter-off branch tested, R3 README and source-policy brought in line, R4 editor drafts refreshed after save), deferred 0, rejected 0. Plan review: READY WITH NOTES.
- Mutation: skipped: no `mutation.md` exists for this change. In round 2 the reviewer mutated `service.ts:225` by hand (always apply the filter) and the AC test failed; file restored.
- Proposed lessons: "When a per-source rule writes to a shared, deduplicated record, decide and test what a second source that disagrees does" and "For every on/off switch an acceptance criterion names, test the off state with input that the on state would reject" (commit `b8e7539`; drop it to reject them).

## Follow-ups
- [FOLLOW-UP] elektroda.pl "Projektowanie Bazar": from a machine with internet, check whether forum 392 has an RSS feed that robots.txt and the terms allow, and add a preset if so (D-10).
- Filtering is not re-applied to signals already stored (out of scope by plan).
- Merged migration: `main` brought its own `0010` (offer drafts), so the two planned migrations became one `0011_mean_zaran.sql` with both additive nullable columns.
- Run `pnpm docker:build` and `pnpm docker:smoke` where Docker is available; neither ran.

## Commits
```
657098c docs(demand-sources): review
6b83568 docs(demand-sources): triage review round 1
b8e7539 docs(demand-sources): propose lessons
b9db994 docs(demand-sources): README and source policy match the S-17 presets (R3)
09dca0f fix(demand-sources): refresh filter drafts from the saved source (R4)
a68292f fix(demand-sources): test the filter-off branch and document first-source-wins (R1, R2)
6c85df6 docs(demand-sources): review
0d647cc Merge main into change/demand-sources
8fa44d4 docs(demand-sources): pr-body
97dbce9 feat(demand-sources): source filter editor, reason text and source policy
77343fe feat(demand-sources): apply the source filter at discovery and count rejections
bf69e8b feat(demand-sources): demand-only presets and per-source filter configuration
7bd486c docs(demand-sources): plan-review
1385f4f docs(demand-sources): plan
33c6907 docs(demand-sources): plan-review
5dd9971 docs(demand-sources): plan
```

<details><summary>Run</summary>

Steps: plan, plan-review (READY WITH NOTES), implement (3 phases), review round 1 (opus, $1.62, APPROVE WITH FOLLOW-UPS, 4 open), fix-review (sonnet, $0.35, 11 turns), review round 2 (opus, $0.37, APPROVE, 0 open), pr-body. No failed step, no stop. Costs of the earlier steps are not in the run summary.

</details>
