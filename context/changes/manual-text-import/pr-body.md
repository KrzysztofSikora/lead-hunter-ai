# feat(manual-text-import): paste a job post, get a deduplicated opportunity in a filterable list

Roadmap S-03. The operator can paste the text of a post (optionally with its URL, which is stored but not fetched) and gets a stored raw signal plus a `NEW` opportunity with `analysisStatus = PENDING`. Re-imports are recognised by canonical URL or content hash. The new *Okazje* view lists opportunities with filters, sort and pagination, and shows an honest empty state. A minimal read-only `/okazje/:id` view is the target of the "już zaimportowane" link. PRD ACs covered: FR-02 AC1–AC4, FR-06 AC1–AC3, FR-11 AC1, FR-12 AC1 (list part).
Closes #4

> **Status:** Ready for review

## ⚠ Needs your decision
No `[STUCK]` or `[REVIEW]` deviations; *Deviations* in the plan is empty. Plan review ended READY WITH NOTES; code review ended APPROVE (round 2, 0 open findings). What is left for you are the costly decisions (public API and stored data shape), most important first:

- **D-14 (costly, data shape):** identity lives in a `signal_identities` table (`PRIMARY KEY (kind, value)`): the first opportunity to see a URL or text hash owns it; on a URL/hash conflict the URL wins. → chose **one identity table**. Alternatives: B: look up `opportunity_evidence` columns with indexes (no new table, but a value can sit under two opportunities and needs a tie rule); C: one signal per import with unique columns (against FR-02 AC2 "one signal"). Switching costs: `schema.ts`, migration `0003_*`, `signal-repository.ts`, `service.ts`. S-09/S-10 will claim identities the same way.
- **D-2 (costly, stored identity values):** the canonical URL drops the fragment, default port, trailing slash and `utm_*`/`fbclid`/`gclid`/`ref`; the content hash is SHA-256 of NFKC, lower-cased, whitespace-collapsed text. → chose **the roadmap list, no extra rules**. Alternatives: B: also sort query parameters and strip `www.`; C: hash the raw text. Switching costs: `identity.ts` plus re-computing stored values. Known consequences (plan *Risks*): on hash-routed boards (`https://site/#/job/123` vs `/456`) different posts merge into one opportunity (the second URL is kept as evidence), and identical text at two URLs merges.
- **D-1 (costly, data shape):** a duplicate creates no signal or opportunity; it adds a `REPEAT_IMPORT` evidence row only when it brings a new URL or new text, and that row is the only copy of the second pasted text. → chose **evidence-on-new-info**. Alternatives: B: duplicates add nothing; C: always add a row. Switching costs: `service.ts`, `isNewEvidence`.
- **D-3 / D-4 (costly, data shape):** `raw_signals.source_type` text (`manual_text` / `manual_url`) without a `sources` table; `opportunities` carries only status plus four nullable analysis columns (category, evidence level, score, confidence). → chose **minimal, additive**. Alternatives: D-3 B/C: create/seed `sources` now; D-4 B/C: fewer or all §14 columns now. Switching costs: schema and migration; S-10 and S-04 extend additively.
- **D-5 / D-8 / D-9 / D-10 / D-11 (costly, public API):** `POST /api/signals/import` (201 `created` / 200 `duplicate` / 400), source-facts vs `analysis` DTO grouping, offset-paginated list query, `sources { checked: 0, errors: [] }` stub, `GET /api/opportunities/:id`. → chose the shapes in `packages/contracts/src/opportunities.ts`. Alternatives: 409 for duplicates; flat DTO with `fieldOrigins`; cursor pagination; fixed UI sentence for sources; link to list instead of detail view. Switching costs: the contracts file, both modules, web client. **S-12 must replace `source-status.ts`**, otherwise the empty state under-reports sources.
- **Plan-review notes not written back into the plan** (all minor, from [plan-review.md](context/changes/manual-text-import/plan-review.md)): #1 and #2 are respected by the code (`deriveTitle(text, sourceUrl)`, query taken from `URL#search`), but the plan text still shows the old wording. #3: `z.httpUrl()` also rejects `localhost`, IP-literal hosts and `example.com.` with `invalid_format` (UI message: "Podaj poprawny adres URL (http lub https)."). This is not stated in D-5. Tell me if you want any of these as a follow-up change, e.g. `R3: fix it`.

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 4) Fresh install, 360 px: *Okazje* shows the empty text, "Sprawdzone źródła: 0", "Błędy źródeł: brak", no example opportunity. Run: `pnpm build && pnpm e2e`, or open `/okazje` on a fresh `DATA_DIR`. Evidence: [empty-360.png](context/changes/manual-text-import/evidence/empty-360.png)
- [ ] (Phase 4) Import a post with a URL containing `?utm_source=x#frag`, then the same URL without them: the second time "Już zaimportowane" with a working link; the view shows the URL as first pasted and "brak analizy — w kolejce". Run: `/import` on the running app. Evidence: [duplicate-360.png](context/changes/manual-text-import/evidence/duplicate-360.png)
- [ ] (Phase 4) With 3+ imports try each filter, both sorts and *Następna*; the filter survives a reload; Polish labels read well; no horizontal scroll. Run: `/okazje` on the running app. Evidence: [list-360.png](context/changes/manual-text-import/evidence/list-360.png) (one import only; 3+ imports are for you)
- [ ] (Phase 4) Paste `<script>alert(1)</script>` and an "ignore previous instructions" line: shown verbatim as text, nothing executes. Run: `/import`, then open the opportunity. Evidence: none

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-6 | Maximum text length | env `IMPORT_MAX_TEXT_CHARS` (1 000–200 000, default 20 000), schema built from config so OpenAPI shows the real limit | fixed constant in contracts; check in the service |
| D-7 | Title and snippet of a manual signal | snippet = trimmed text; title = first non-blank line cut to 200 code points; URL-only → title = URL as pasted; `publishedAt` null, `availability` `NOT_CHECKED` | optional title field in the form; null title |
| D-12 | Data fetching in the web app | plain `apiFetch` + `useEffect`; filters, sort and page in the URL query | add TanStack Query now; filters in component state |
| D-13 | e2e coverage | one more test in `e2e/smoke.spec.ts` (4th of 5 login attempts), screenshots as evidence | no e2e; a new spec file |

## Quality
- Gates (from [review.md](context/changes/manual-text-import/review.md)): typecheck ok, lint ok, unit tests ok (23 files, 214 tests), e2e ok (4 tests), **image not run**: `corepack` inside `docker build` cannot fetch pnpm 12.15.0 through the sandbox's TLS proxy (`self-signed certificate in certificate chain`). This is environment, not this change, which touches no `package.json` or lockfile; the CI `image` job is the authority.
- Review: APPROVE, round 2. Round 1 raised 5 findings (1 major, 4 minor); fixed 5, deferred 0, rejected 0:
  - R1 (major) unplanned component test `ImportPage.test.tsx` outside the test budget, removed (71f019b)
  - R2 empty `minScore=` silently became `0`, now means absent (68bce4d)
  - R3 page beyond the last one, *Poprzednia* now stays in range (69f699e). The out-of-range page itself still shows "Razem: N" with no items; the reviewer accepted this because the way back is one click.
  - R4 title cut split an emoji, now cut by code points (459ade3)
  - R5 three unused UI strings removed (ea927ed)
- Mutation: skipped: S-03 is not a mutation target in the test plan (no `mutation.md`); `bug` mutants: none.
- Proposed lessons: none.

## Follow-ups
- Out-of-range list page (`?page=N` beyond the last) still renders "Razem: N" with an empty list (see R3 above); acceptable, optional polish.
- S-12 must replace the `source-status.ts` stub (D-10).
- S-09 will fill `snippet`/`content_hash` for URL-only signals; whether it merges opportunities when the fetched hash is already owned is for its plan.
- Hash-routed boards merge posts through the fragment-dropping rule (see D-2); revisiting is a roadmap decision for S-09/S-10.
- The e2e uses the 4th of 5 login attempts per 15 minutes; a later e2e test needs a shared login (storage state).

## Commits
```
cf48ff7 docs(manual-text-import): review
bbd50d8 docs(manual-text-import): triage review round 1
ea927ed fix(manual-text-import): drop unused UI strings (R5)
459ade3 fix(manual-text-import): cut derived title by code points (R4)
69f699e fix(manual-text-import): previous page never leaves the valid range (R3)
68bce4d fix(manual-text-import): empty list query values mean not given (R2)
71f019b fix(manual-text-import): remove component test outside the test budget (R1)
7bfba6f docs(manual-text-import): review
5377651 feat(manual-text-import): import view, e2e flow and README
8b5e63f feat(manual-text-import): Okazje list and opportunity view in the web app
21b5eec feat(manual-text-import): opportunity list and detail API
06f38e8 feat(manual-text-import): manual import API with identity rules and storage
f91d53a docs(manual-text-import): plan-review
5781e48 docs(manual-text-import): plan
72be6b0 docs(manual-text-import): plan-review
5c3b386 docs(manual-text-import): pr-body
bd1c128 docs(manual-text-import): plan-review
5e39139 docs(manual-text-import): plan
9dba6a6 docs(manual-text-import): plan-review
2ae007e docs(manual-text-import): plan
```

<details><summary>Run</summary>

Base main, branch `change/manual-text-import`, started 2026-10-25 10:52 UTC; no failed step, no stop.

| Step | Model | Result | Cost |
|------|-------|--------|------|
| plan-review (round 1) | opus | NEEDS CHANGES | $0.41 |
| plan (revise) | opus | success, 10 turns | $0.51 |
| plan-review (round 2) | opus | READY WITH NOTES | $0.54 |
| implement, phases 1–4 | sonnet | success, 19 / 13 / 14 / 17 turns | $0.62 + $0.38 + $0.42 + $0.37 |
| review (round 1) | opus | APPROVE WITH FOLLOW-UPS, 5 findings | $1.47 |
| fix-review | sonnet | success, 11 turns | $0.18 |
| review (round 2) | opus | APPROVE, 0 open | $0.26 |

Phases ticked: 4/4. Total of listed steps: about $5.16 (pr-body step not included).
</details>
