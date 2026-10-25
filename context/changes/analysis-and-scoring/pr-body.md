# feat(analysis-and-scoring): pre-filter, mock analysis and deterministic 0–100 scoring

Roadmap item S-04. New opportunities are now picked up without operator action, pass a deterministic pre-filter, are analysed by a provider behind an `LlmProvider` port (only the deterministic `mock` provider here; real providers are S-05) into a validated schema v1, and get a rule-based score with a five-part breakdown and a separate confidence. The *Okazje* list and the detail show the results labelled `DEMO / MOCK`, with filters (minimum score, age, amount, industry, language, work mode, country, type). PRD ACs covered: FR-07 AC1–AC3, FR-08 AC5, AC6, AC8, FR-10 AC1–AC6. The rubric is in [`docs/scoring.md`](../../../docs/scoring.md).
Closes #5

> **Status:** Draft: the runner stopped at `fix-review` with `[STUCK]`. The review itself is APPROVE WITH FOLLOW-UPS (0 open findings) and the gates typecheck, lint, unit tests and e2e are green. The only open point is a tree-cleanup decision (first item below).

## ⚠ Needs your decision
- **[STUCK] Evidence of other changes was overwritten.** The e2e run regenerated three screenshots that belong to other changes (`manual-text-import/evidence/empty-360.png`, `operator-login/evidence/shell-360.png`, `operator-profile/evidence/profile-360.png`). The agent could not restore them (`git checkout` was denied), and the runner committed them as `f9b7283 wip(analysis-and-scoring): unfinished work from step fix-review`. Either drop that commit (`drop the wip commit`) to keep the old evidence, or keep it.
- **[REVIEW] Profitability scores only a budget stated by the source** (plan-review #7). A model-proposed price is a hypothesis, so it scores a neutral 5/15; judging it against the profile's own hourly rate is circular. The plan's rubric row said "sourceBudget else proposedPrice". Alternative: score the proposed price too, so every budget-less mock result with a rate range would get 15/15. See [`docs/scoring.md`](../../../docs/scoring.md).
- **D-10 (prd):** `LLM_PROVIDER` unset means "analysis not configured" (FR-08 AC5), not "mock". This contradicts the tech-stack line "LLM provider defaults to `mock` when no key is set"; the plan asks you to confirm D-10, after which the tech-stack line should be corrected. Alternative B: default to mock when unset (then FR-08 AC5 could never be shown and demo results would appear on a real install). Switching: `packages/config/src/env.ts`, `.env.example`, e2e config.
- **D-5 (costly):** a pre-filter rejection stores `businessStatus = REJECTED`, `analysisStatus = SKIPPED` (new public enum value, a fourth beyond brief §10.1), and the rule id; `no_text` gives `NEEDS_VERIFICATION`. Alternatives: B keep `NEW` and mark only the analysis; C keep `PENDING`. Switching costs: public API enum, stored values; S-06/S-13 must render `SKIPPED`.
- **D-7 (costly):** analysis schema v1 is a discriminated union (`ANALYSED` / `INSUFFICIENT_DATA`) with money in integer minor units. Alternatives: B one object with an `insufficientData` flag; C §6.1 numbers in major units. Switching costs: stored JSON, schema version 1, contracts.
- **D-8 (costly):** new `analyses` table (one row per attempt) plus ten denormalised nullable columns on `opportunities` (migration `0004_*`). Alternatives: B JSON on `opportunities`; C separate tables for breakdown and attempts. Switching costs: migration, repositories.
- **D-11 (costly):** `GET /api/analysis/status` as a public endpoint. Alternatives: B counts in `GET /api/opportunities`; C no endpoint. Switching costs: API contract, web, S-13.
- **D-12 (costly):** DTO shape (`AnalysisSummary.demo`, `prefilter`, `latestAnalysis`). Alternatives: B flattened result; C separate `/analysis` route. Switching costs: contracts, web.
- **D-13 (costly):** the API applies no minimum score by default and unknown values pass the filters; "default 65" is a one-click "Tylko ≥ 65" link. Alternatives: B unknown values excluded; C apply 65 by default in the list. Switching costs: public query contract, repository.
- **Image gate not verified:** `pnpm docker:build` fails inside the sandbox (corepack cannot fetch pnpm: "self-signed certificate in certificate chain" from the agent proxy), before any project code; same in Phase 3 and both review rounds. Please build the image on a normal machine.

Reply in a review comment, e.g. `D-5: take B`, `drop the wip commit`, `profitability: score the proposed price too`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 5) With `LLM_PROVIDER=mock`, import `apps/api/test/fixtures/llm/synthetic-direct-pl.txt` and open it at 360 px: `DEMO / MOCK` in the list and on the detail, five components add up to the score, Polish justifications read sensibly, price says "szacunek (hipoteza)". Run: `LLM_PROVIDER=mock pnpm build && pnpm start`, Import view. Evidence: [`detail-360.png`](evidence/detail-360.png), [`list-360.png`](evidence/list-360.png)
- [ ] (Phase 5) Without `LLM_PROVIDER` (restart): *Okazje* says analysis is not configured; import still works and the item stays "Analiza: oczekuje". Run: `pnpm start` without the variable, import any post. Evidence: none
- [ ] (Phase 5) Import `synthetic-seeking-work.txt`: the list shows "Analiza: pominięta — oferta wykonawcy, nie zlecenie" and status *Odrzucona*. Run: Import view with the fixture. Evidence: none
- [ ] (Phase 5) Try each new filter and "Tylko ≥ 65" on 3+ imports: results match, an item without a budget stays under a minimum amount; no horizontal scroll; Polish labels read well. Run: *Okazje* at 360 px. Evidence: none
- [ ] (Phase 5) Read [`docs/scoring.md`](../../../docs/scoring.md): the rubric is understandable and the numbers match what the detail shows. Run: open the file. Evidence: none

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-1 | Demand-evidence caps | 30 / 18 / 10 / 6 (user, roadmap) | – |
| D-2 | Rubric of the five components | Integer tables, rubric version 1 | Weighted fractions; provider scores each component |
| D-3 | Who decides `confidence` | Deterministic rule in `score.ts` | Provider returns it; fixed `MEDIUM` |
| D-4 | How analysis is triggered | In-process serial `AnalysisRunner`: kick after import, at start, every 10 min | Analyse inside the import request; wait for S-12 scheduler |
| D-6 | Pre-filter rules and order | `no_text`, `seeking_work`, `spam`, `language`, `too_old`, `excluded_technology`, `excluded_category`, `no_profile_match` (not for manual imports) | `no_profile_match` for manual imports too; score-like weighting |
| D-9 | Daily analysis limit | `ANALYSIS_DAILY_LIMIT` (default 20), counted per Europe/Warsaw day, for every provider | Count only paid providers; UTC day |
| D-14 | Output guard in this item | Budget quote, verbatim source facts, evidence guard, independent of provider | Rely on provider only; whole FR-08 AC4 guard now |
| D-15 | Mock provider rules | Deterministic keyword rules, texts prefixed "DEMO / MOCK:" | Fixed canned analysis; seeded random |
| D-16 | Language of justifications | Polish strings stored in `breakdown_json` (plan-review #10: reversible by rescoring from `result_json`) | Codes + parameters rendered by the web |
| D-17 | Status changes and history | System moves only while `NEW`; no activity event until S-08 | Create `activity_events` now |

## Quality
- Gates (round 2): typecheck ok, lint ok, unit tests ok (32 files, 376 tests), e2e ok (4 tests), image **fail** (environment, see above).
- Review: APPROVE WITH FOLLOW-UPS, round 2: R1–R8 all fixed (R1, R2, R7 major; R3–R6, R8 minor), deferred 0, rejected 0. Plan review: READY WITH NOTES (12 notes, majors #1–#5 applied; #7 is the `[REVIEW]` above). See [`review.md`](review.md) and [`plan-review.md`](plan-review.md).
- Mutation: 82.4% → 98.5% on `scoring/rubric.ts` and `score.ts` (target 80%); 3 survivors, all justification wording; `bug` mutants: none. See [`mutation.md`](mutation.md).
- Proposed lessons: "Validate every value against its contract schema before storing it, not only when reading it back" and "A guard that verifies a quote must also verify the values derived from it" (commit `0f05dd0`; drop it to reject them).

## Follow-ups
- **[FOLLOW-UP]** Rescore on profile save: scores use the profile at analysis time; scoring is pure, so it is a loop over `analyses`.
- The 10-minute timer (D-4) is a stand-in for S-12; S-12 must replace it with its job and lock, or two drains could overlap across processes.
- System moves to `REJECTED`/`NEEDS_VERIFICATION` leave no activity event until S-08 (D-17); S-08's plan should backfill or accept that history starts there.
- S-06/S-13 must render the new `SKIPPED` analysis status.
- `too_old` and `no_profile_match` cannot fire for manual imports (reachable from S-10 sources); `no_profile_match` has no test yet.
- The evidence-guard cue list (`cues.ts`) may downgrade real hiring posts without a listed cue once S-05 brings real models; the guard note makes it visible.
- URL/e-mail/person/company guard, real adapters, budget cap and re-analyse route stay in S-05.

## Commits
```
f9b7283 wip(analysis-and-scoring): unfinished work from step fix-review
60ad710 docs(analysis-and-scoring): note blocked tree cleanup
f784249 docs(analysis-and-scoring): guard rules for currency and quote boundaries (R7)
aa52b12 docs(analysis-and-scoring): triage review round 2
476211b fix(analysis-and-scoring): mock reads comma thousands and never starts mid-number (R8)
2143ff0 fix(analysis-and-scoring): budget guard checks currency and quote boundaries (R7)
50b910a docs(analysis-and-scoring): review
c1b56c5 docs(analysis-and-scoring): triage review round 1
0f05dd0 docs(analysis-and-scoring): propose lessons
01de258 docs(analysis-and-scoring): document pre-filter rules and the evidence guard (R6)
21aab4a fix(analysis-and-scoring): filter form normalises country, accepts decimal amounts, caps age and asks for a currency (R5)
fb775ed fix(analysis-and-scoring): label completed insufficient-data mock results as demo in the list (R4)
d4180a8 fix(analysis-and-scoring): mock reads decimal and thousands separators in budgets (R3)
1ea746a fix(analysis-and-scoring): guard checks the budget amounts against the quote and rejects empty quotes (R2)
54c05d7 fix(analysis-and-scoring): keep score justifications within the contract and validate the breakdown before saving (R1)
81c9f3e docs(analysis-and-scoring): review
abc6a65 docs(analysis-and-scoring): mutation
76dc1c8 test(analysis-and-scoring): strengthen assertions from mutation check
9913439 feat(analysis-and-scoring): analysis section, DEMO / MOCK labels, filters and status line in the web UI
c189d4a feat(analysis-and-scoring): analysis status route, analysis in opportunity DTOs and list filters
3ccab0e docs(analysis-and-scoring): record why the image gate could not run in phase 3
fd05116 feat(analysis-and-scoring): analyses table, analysis runner and LLM_PROVIDER config
a28c727 feat(analysis-and-scoring): pre-filter, output guard, mock provider and analysis ports
93c4147 feat(analysis-and-scoring): analysis schema v1 and deterministic scoring rubric
ff2cdfe docs(analysis-and-scoring): plan-review
c4e25a4 docs(analysis-and-scoring): plan
```

<details><summary>Run</summary>

Steps (all attempt 1, base `main`): plan (opus, $2.80), plan-review (opus, $1.00, READY WITH NOTES), implement ×5 phases (sonnet, $0.61 + $0.57 + $0.91 + $0.64 + $0.55), mutation (sonnet, $0.34), review round 1 (opus, $1.79, 6 findings), fix-review (sonnet, $0.64), review round 2 (opus, $0.69, 2 findings), fix-review (sonnet, $0.31, stopped as `[STUCK]` on the three foreign screenshots). Phases ticked: 5/5. Total about $11.85.
</details>
