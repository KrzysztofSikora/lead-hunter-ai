# feat(operator-profile): operator profile stored in SQLite, edited in a Polish Profil view

Roadmap S-02: the operator has one profile (skills, preferences, constraints, goals) stored as a validated JSON document in SQLite, read and replaced through `GET`/`PUT /api/profile`, and edited in the new *Profil* view (react-router, nav *Start* / *Profil*). A fresh database is seeded with an anonymous example profile labelled `PRZYKŁAD`. Later slices read the profile through `createProfileService().get()`. Covers PRD FR-01 AC1–AC4, and the field-level 400 shape of FR-25 AC1 for every route.
Closes #3

> **Status:** Ready for review

## ⚠ Needs your decision
Costly decisions (public API, persisted shape, new dependency), most important first. Full text in [`plan.md`](context/changes/operator-profile/plan.md#decisions).

- **D-5 (costly):** the 400 body of **every** route, including login, changes from Fastify's default to `{ error: "validation_failed", fields: [{ path, code, message }] }` (dot-joined path, one entry per unknown key) → chose **a root error handler for all routes**. Alternatives: B: handle it only in the profile routes (login's 400 stays, but FR-25 AC1 wants one shape); C: Zod `flattenError` (standard, loses nested paths and unknown-key names). Switching costs: `apps/api/src/http-errors.ts` and the `ValidationError` contract; nothing in `apps/` or `e2e/` reads the old body. Malformed JSON / empty body keeps Fastify's default body (plan-review 8).
- **D-2 (costly):** profile field shape — lists of trimmed tags, enums for billing models and work modes, ISO codes for languages/countries, `Money { amountMinor, currency }` per amount (PLN/EUR/USD), `rateRanges[]`, strict objects → chose **per-amount currency and enums**. Alternatives: B: one profile currency (simpler form, worse for Polish vs international rates); C: free-text billing/work mode/languages (no enums to maintain, but the pre-filter cannot match deterministically). Switching costs: `packages/contracts/src/profile.ts`, stored JSON, example profile, form, API tests; pre-filter and scoring (S-04) build on this shape.
- **D-1 (costly):** storage → chose **one row `operator_profile(id CHECK id = 1, schema_version, data JSON, is_example, updated_at)`**, validated on write and on read. Alternatives: B: one column per field plus child tables (SQL-queryable, every new field is a migration); C: brief §14's six JSON group columns. Switching costs: migration `0002_lyrical_the_hood.sql`, `profile-repository.ts`, `schema.ts`. Validation on read means an unreadable stored row is a hard 500 on `GET` (a valid `PUT` repairs it, tested).
- **D-4 (costly):** public API → chose **`GET /api/profile` and full-replace `PUT /api/profile`**, response `{ profile, example, updatedAt }`. Alternatives: B: `PATCH` with partial updates; C: `POST`. Switching costs: routes, contract, web client, OpenAPI.
- **D-8 (costly):** new runtime dependency → chose **`react-router` 8.5.0 (exact pin), declarative mode**, plain `apiFetch` with local state. Alternatives: B: view state without a router (no deep link to *Profil*; S-03 would add the router anyway); C: TanStack Query too (not needed for one GET). Switching costs: `apps/web/package.json`, `main.tsx`, `App.tsx`.
- **Plan review / review leftovers:** none open. Plan review was READY WITH NOTES (8 findings, all applied or logged in *Deviations*); review APPROVE, 2 minor findings, both fixed.

Reply in a review comment, e.g. `D-5: take B`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
Evidence screenshot: [`profile-360.png`](context/changes/operator-profile/evidence/profile-360.png). Run the app with `pnpm build && DATA_DIR=$(mktemp -d) OPERATOR_PASSWORD_HASH=<hash from pnpm auth:hash> pnpm start`.
- [ ] (Phase 2) `/profil` at 360 px: sections readable, labels Polish and clear, `PRZYKŁAD` visible on a fresh install — open `/profil` on a phone or 360 px DevTools — evidence: [`profile-360.png`](context/changes/operator-profile/evidence/profile-360.png)
- [ ] (Phase 2) Split `70` / `20` and a rate range with max < min, press *Zapisz*: Polish errors next to those fields, nothing saved (reload shows old values) — same server, *Profil* → *Dodaj przedział*, Od `100`, Do `50` — evidence: none
- [ ] (Phase 2) AC4: no real name, rate, amount or client in the repository — read `apps/api/src/modules/profile/example.ts` and run `git grep -n -i -E "[0-9]+ ?(zł|pln|eur|usd)\b" -- apps packages e2e` — evidence: none

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-3 | Example profile and `PRZYKŁAD` label | Constant in `modules/profile/example.ts`, inserted with `is_example = 1` on first start; any successful `PUT` sets `is_example = 0` (user default from roadmap S-02 + agent) | B: no row, `GET` returns the constant until first save; C: label by comparing with the constant |
| D-6 | Wording of field errors in the UI | Polish text in `strings.pl.ts` by error `code`; two domain refinements carry Polish messages in contracts; form runs the same Zod schema before sending | B: Polish messages for all rules in contracts; C: Zod's English messages |
| D-7 | Money input | Whole units in the form, converted by integer/string arithmetic; extended in Phase 2 to show non-whole amounts exactly and accept up to two decimals | B: decimal string parsing only; C: minor units in the form |
| D-9 | List fields in the form | One textarea per tag list, one item per line; trimmed, deduplicated; rate ranges as rows with add/remove | B: chip inputs; C: comma-separated text |
| D-10 | Profile reader for later slices | `createProfileService(deps).get()` validates stored JSON; later slices get the service or a `ProfileReader` port | B: query the repository directly |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (19 files, 135 tests), e2e ok (3 tests); image **not run** (sandbox: corepack inside `docker build` cannot fetch pnpm through the TLS proxy, `SELF_SIGNED_CERT_IN_CHAIN`, not caused by this change; `pnpm install --frozen-lockfile --offline` confirms the lockfile) — please run `pnpm docker:build` on a machine with network access.
- Review: APPROVE, round 1: fixed 2 (R1 rate-range list error not shown and no row cap → `b2c83e5`; R2 README human checks → `fc17acc`), deferred 0, rejected 0. See [`review.md`](context/changes/operator-profile/review.md).
- Mutation: skipped: no mutation target for S-02 in the test plan; no `bug` mutants.
- Proposed lessons: none.

## Follow-ups
None.

## Commits
```
2baa040 docs(operator-profile): triage review round 1
fc17acc fix(operator-profile): list profile human checks in README (R2)
b2c83e5 fix(operator-profile): show rate-range list errors and cap added rows (R1)
27de4d6 docs(operator-profile): review
df152dd feat(operator-profile): profile view in the web app
8af4b2f feat(operator-profile): profile contract, storage and API
c60fb40 docs(operator-profile): plan-review
1eeb54d docs(operator-profile): plan
```

<details><summary>Run</summary>

Branch `change/operator-profile`, base `main`, started 2026-10-25T10:12:56+00:00. No failed step, no draft reason.

| Step | Model | Attempts | Cost | Result |
|------|-------|----------|------|--------|
| plan | opus | 1 | $1.56 (21 turns) | success |
| plan-review | opus | 1 | $0.72 | READY WITH NOTES |
| implement (phase 1) | sonnet | 1 | $0.38 (11 turns) | success |
| implement (phase 2) | sonnet | 1 | $0.43 (13 turns) | success |
| review | opus | 1 | $0.92 | APPROVE, 2 findings |
| fix-review | sonnet | 1 | $0.16 (14 turns) | 0 open findings |
| pr-body | sonnet | 1 | not yet recorded | - |

Phases ticked: 2/2.
</details>
