# feat(today-brief): Today view and daily brief at GET /api/digest/today

Roadmap item S-13 (Today and daily brief). The Start route is now the Today view (nav "Dziś") and `GET /api/digest/today` returns the brief in the order of PRD §11.1: source status, new signals and opportunities, TOP up to 5 (direct requests first, at most one near-duplicate pair), the best next step, LLM tokens ("brak danych" for money), follow-ups due today or overdue, source errors, and a separate "Pomysły produktowe / słabe sygnały" section. With no qualifying opportunity it shows "Brak zweryfikowanych okazji dla tego okresu" with the number of sources checked and their errors. Covers FR-16 AC1–AC3, FR-12 AC1 (Today) and FR-14 AC4 (due follow-ups in Today); FR-10 AC6 only partly (see below).
Closes #14

> **Status:** Ready for review

## ⚠ Needs your decision
- **[REVIEW] FR-10 AC6 is only partly covered for the brief** (plan-review 4). The brief honours the minimum score (`minScore`, default 65, D-8) only. Excluded industries, source age, amount, job type, language and geography are not applied. Alternative: accept the list's filter subset in `DigestQuery`. Follow-up below for when filters are persisted.
- **D-1 (costly):** response shape of `GET /api/digest/today` → chose **structured JSON (`DigestToday`); the web app renders the §11.1 wording**. Alternatives: B: also a `text` field with the §11.1 plain text (ready for Telegram, P1); C: text only. Switching costs: `packages/contracts/src/digest.ts` and the web page; B is additive, so cheap later. It fixes the public API surface for FR-29.
- **Plan review leftovers:** none. All four majors (R1–R4 of the plan review) were answered in the plan (D-14, e2e assertions, partial FR-10 AC6 coverage stated above).

Reply in a review comment, e.g. `D-1: take B`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 2) Today at 360 px and on a laptop with a few demo imports: sections in §11.1 order, Polish wording reads naturally, the "wniosek modelu" label on next steps is clear. Run: `docker compose up --build`, log in, open `/` after importing a few DEMO posts on `/import`. Evidence: [`today-360.jpg`](context/changes/today-brief/evidence/today-360.jpg) (360 px, one contacted lead with a follow-up due)
- [ ] (Phase 2) With no opportunities: the empty-state text, source count and errors appear and nothing else pretends to be a lead. Run: open `/` on a fresh database. Evidence: none (asserted by `e2e/smoke.spec.ts` step 1)

## Other decisions made by the agent (cheap to change)
Full table with reasons: [plan.md#decisions](context/changes/today-brief/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | What "new" means | Created since Warsaw midnight | Last 24 h; since the previous brief was opened |
| D-3 | Which opportunities can enter TOP / weak | Open statuses NEW, QUALIFIED, SAVED, OFFER_DRAFTED; analysis COMPLETE; last 7 days | All open ones of any age; only today's |
| D-4 | Main vs weak section | Weak = `PRODUCT_HYPOTHESIS` or evidence `INDIRECT_SIGNAL`/`SPECULATIVE`; main needs `score >= minScore`, weak up to 5 with no threshold | Split by category only; threshold on weak too |
| D-5 | Near-duplicate measure | Token Jaccard ≥ 0.6 on title + buyer | Normalised Levenshtein; identical title only |
| D-6 | Ordering | `DIRECT_REQUEST` first, then score, createdAt, id | Score only; weighted bonus |
| D-7 | How many in TOP | Up to 5, never padded | Always 3 |
| D-8 | Threshold/filters | `minScore` param, default 65, no other filter | List's filters; no parameter |
| D-9 | LLM cost before S-05 | Tokens (or null); money always "brak danych" | Show 0 for the mock; estimate from tokens |
| D-10 | Best next step | Oldest due follow-up, else TOP[0] `nextAction`, else none | Always TOP[0] |
| D-11 | Source status counts | Current state of enabled sources | Failed job runs of today |
| D-12 | Source of follow-ups on Today | In the digest response | Second request to `GET /api/pipeline` |
| D-13 | Nav label and route | `/` stays, link "Dziś" | New route `/dzis` |
| D-14 | Candidate rows | `score`, `category`, `evidenceLevel` NOT NULL in SQL (prevents a 500) | Filter in `select.ts` |
| D-15 | Near-duplicate invariant | At most one near-duplicate per TOP item, also along A~B~C chains | Group of 3 |
| D-16 | `newAboveThreshold` | Main-section rows ≥ `minScore`, any status, created today | Open statuses only |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok, e2e ok (5 passed), image not run (no Docker daemon in this environment; the diff does not touch `Dockerfile` or compose).
- Review: APPROVE, round 1: fixed 3 (R1 untested `opportunity` next step, R2 duplicated source-error mapping and DEMO rule, R3 partial token sum shown as the day's total, now `llm.reported`), deferred 0, rejected 0. See [review.md](context/changes/today-brief/review.md).
- Plan review: READY WITH NOTES, 8 findings (4 major, 4 minor), all answered. See [plan-review.md](context/changes/today-brief/plan-review.md).
- Mutation: skipped: no `mutation.md` was produced for this change, so no score is available. `bug` mutants: none reported.
- Proposed lessons: none.

## Follow-ups
- [FOLLOW-UP] Persisted filters (FR-10 AC6) applied to the brief once they exist.
- [FOLLOW-UP] FR-09 AC3: show how much work waits for the next day when a daily limit is reached; limits belong to S-05, add the count to `DigestToday` there.
- [FOLLOW-UP] Plain-text rendering of the brief (D-1 B) when Telegram/e-mail notifications (FR-29) are built.
- Note: the S-08 `pipeline-and-payments/evidence/today-360.jpg` stays as committed and now shows the old Start view (stale).

## Commits
```
8f95f43 docs(today-brief): triage review round 1
76d0d51 fix(today-brief): show how many analyses reported tokens; assert the opportunity next step (R1, R3)
ee03279 fix(today-brief): share the source-error mapping and the DEMO rule (R2)
94aefb9 docs(today-brief): review
9b51b60 feat(today-brief): Today view with the daily brief
0cbb02d feat(today-brief): daily brief API at GET /api/digest/today
389a24e docs(today-brief): plan-review
6a6953c docs(today-brief): plan
```

<details><summary>Run</summary>

Base main, branch change/today-brief, started 2026-10-25 17:20:30 UTC. No failed step, no draft reason.

| Step | Attempts | Model | Cost |
|------|----------|-------|------|
| plan | 1 | opus | $1.75 |
| plan-review (READY WITH NOTES) | 1 | opus | $0.75 |
| implement (phase 1) | 1 | sonnet | $0.70 |
| implement (phase 2) | 1 | sonnet | $0.40 |
| review (APPROVE) | 1 | opus | $0.97 |
| fix-review | 1 | sonnet | $0.25 |

Total: $4.82 before pr-body. Phases ticked 2/2.
</details>

