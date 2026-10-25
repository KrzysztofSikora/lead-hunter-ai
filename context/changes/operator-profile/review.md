# Review: operator-profile

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (19 files, 135 tests), e2e ok (3 tests), image not run (sandbox: corepack inside `docker build` cannot fetch pnpm through the TLS proxy, `SELF_SIGNED_CERT_IN_CHAIN`, not caused by this change; `pnpm install --frozen-lockfile --offline` confirms the lockfile matches), mutation n/a (no mutation target for S-02 in the test plan) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/profile.ts` | done | Schemas match *Design*; custom refinements carry Polish messages (D-6) |
| `packages/contracts/src/index.ts` | done | Exports the profile schemas |
| `apps/api/src/infrastructure/db/schema.ts` | done | `operator_profile` with `CHECK (id = 1)` (D-1) |
| `apps/api/migrations/0002_lyrical_the_hood.sql`, `meta/*` | done | Additive, generated; CHECK emitted (logged deviation) |
| `apps/api/src/infrastructure/db/profile-repository.ts` | done | `onConflictDoNothing` / `onConflictDoUpdate` on `id` |
| `apps/api/src/modules/shared/clock.ts`, `modules/auth/ports.ts` | done | `Clock` moved, re-exported from auth |
| `apps/api/src/modules/profile/{ports,example,service,routes}.ts` | done | As in *Design*; read-side parse, `ensureExample` at registration (D-3, D-10) |
| `apps/api/src/http-errors.ts` | done | One root handler for Zod schema errors (D-5); malformed JSON keeps default (logged, plan-review 8) |
| `apps/api/src/app.ts`, `apps/api/src/server.ts` | done | Error handler before auth; profile deps wired |
| `apps/api/test/helpers/app.ts` | done | `openTestDb(dir?)`, `buildTestApp({ dir })` (plan-review 6) |
| `apps/api/test/profile.int.test.ts` | done | AC1–AC4, login 400 shape, corrupt-row 500 then repair |
| `apps/web/package.json`, `pnpm-lock.yaml` | done | `react-router` 8.5.0 exact pin (D-8) |
| `apps/web/src/main.tsx`, `App.tsx`, `App.module.css` | done | `BrowserRouter`, nav, routes, fallback to `/` |
| `apps/web/src/api/profile.ts` | done | `getProfile` / `saveProfile` through `apiFetch` |
| `apps/web/src/ProfilePage.tsx`, `ProfilePage.module.css` | done | Four sections, `PRZYKŁAD` text label, field errors with `aria-describedby` |
| `apps/web/src/profileForm.ts` | unplanned | Logged deviation (Phase 2): pure form ↔ payload conversion, D-7 extended to two decimals |
| `apps/web/src/strings.pl.ts` | done | All new UI text here |
| `apps/web/src/App.test.tsx` | done | `MemoryRouter` wrapper only |
| `e2e/smoke.spec.ts` | done | Third test at 360×740, 3 of 5 login attempts, screenshot evidence |
| `README.md` | done | *Co działa* gains the profile (see R2) |
| `context/changes/operator-profile/evidence/profile-360.png` | done | 360×740 screenshot |
| `context/roadmap.md`, `plan.md`, `plan-review.md` | unplanned | Workflow artifacts |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | All FR-01 ACs proven by integration tests and e2e; money conversion is integer/string arithmetic; one unplaced-error edge (R1) |
| Design | ok | Module/port/repository layering follows S-01; the error shape lives in one file |
| Safety | ok | Strict schemas at the boundary, deny-by-default guard covers the new routes, example profile anonymous |
| Tests | ok | Behavioural, deterministic, cover failure paths (AC3 table, corrupt row); within the test budget |
| Simplicity | ok | Small functions, no dead code; `profileForm.ts` keeps the component readable |
| Plan fidelity | ok | Every planned file changed as intended; deviations logged; all plan-review findings applied or logged |
| Agent decisions | ok | Costly D-1, D-2, D-4, D-5, D-8 each sit in one or two files and are swappable as the plan claims |

## Findings
### R1: A validation error on the rate-range list itself is never shown
- Severity: minor
- Where: `apps/web/src/ProfilePage.tsx:300-317`
- Problem: errors are shown only where an `errorLine` exists. The rates section renders `errorLine` for `rateRanges.<i>.minMinor` / `.maxMinor` but not for `rateRanges`. *Dodaj przedział* has no limit, and the schema allows at most 10 ranges; with 11 rows, `formToProfile` returns `[{ path: "rateRanges", code: "too_big" }]` (verified with a scratch Vitest probe), so the user sees "Popraw zaznaczone pola." with no field marked and no way to tell what is wrong. The same applies to any server error whose path has no matching `errorLine`.
- Fix: add `{errorLine('rateRanges', 'rateRanges')}` under the rates list (with an exact-path match so per-row errors are not shown twice) and disable *Dodaj przedział* at 10 rows; optionally show any error that matches no rendered field next to the status line.
- Effort: small
- Lesson candidate: no
- Decision: open

### R2: README *Co wymaga ręcznej weryfikacji* does not list the new human checks
- Severity: minor
- Where: `README.md:47-50`
- Problem: FR-26 AC1 says each roadmap item updates the three-part section. This change adds the profile to *Co działa* only. The plan's human checks (profile view at 360 px, Polish field errors next to the fields, AC4 repository search) are not in *Co wymaga ręcznej weryfikacji*, which still names only the shell and login form on a phone.
- Fix: add "widok *Profil* na telefonie i komunikaty błędów przy polach" to *Co wymaga ręcznej weryfikacji*.
- Effort: small
- Lesson candidate: no
- Decision: open
