# Review: operator-login

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (122/122), e2e ok (2/2, Chromium via `E2E_CHROMIUM_PATH`), image not run (sandbox: `pnpm install` inside the build fails with `SELF_SIGNED_CERT_IN_CHAIN`, the proxy CA is not trusted in the container; environment, not the change; CI `image` job is the authority), mutation n/a (S-01 is not a mutation target) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/config/src/env.ts` | done | `PASSWORD_HASH_PATTERN` exported; refine with ln/r/p bounds (logged deviation, plan-review 4) |
| `packages/config/src/env.test.ts` | done | valid hash; malformed and out-of-range cases; placeholder refused on 0.0.0.0 |
| `apps/api/src/infrastructure/auth/scrypt-password.ts` | done | D-1 format, params read from the string, `timingSafeEqual` |
| `apps/api/src/infrastructure/auth/scrypt-password.test.ts` | done | round trip, wrong password, other params, salt, malformed |
| `apps/api/src/cli/auth-hash.ts` | done | D-9; no config load; built `dist/cli/auth-hash.js` checked by hand (prints a valid hash) |
| `apps/api/package.json`, `package.json` | done | `auth:hash` scripts; exact pins for cookie/rate-limit |
| `apps/api/test/cli.int.test.ts` | done | piped hash verifies with an invalid `PORT`; short password exits 1 |
| `.env.example`, `README.md` | done | `pnpm auth:hash`, Docker form with existing `.env`, D-6 note, *Dostęp zdalny* |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0001_*` (+ meta) | done | `sessions` as in D-3 |
| `apps/api/src/infrastructure/db/session-repository.ts` | done | Drizzle implementation of the port |
| `apps/api/src/modules/auth/{ports,service,routes}.ts` | done | guard on `routeOptions.url` (plan-review 1); child scope error handler for 429 (logged deviation) |
| `packages/contracts/src/{auth,index}.ts` | done | schemas as in *Design* |
| `apps/api/src/app.ts` | done | `AppDeps.auth`; `registerAuth` before health |
| `apps/api/src/server.ts` | done | wiring; see R3 |
| `apps/api/test/helpers/app.ts` | done | `FakeClock`, `loginAsOperator`, `noPassword` |
| `apps/api/test/auth.int.test.ts` | done | tests 1–8 of the plan plus `%61pi` bypass and multi-device; see R1 |
| `apps/api/test/openapi.int.test.ts` | done | logs in first |
| `apps/web/src/api/client.ts`, `api/auth.ts` | done | see R2 |
| `apps/web/src/LoginForm.tsx`, `App.tsx`, `App.module.css`, `strings.pl.ts` | done | D-10 state machine; strings as planned |
| `e2e/env.ts`, `e2e/smoke.spec.ts`, `playwright.config.ts` | done | login, wrong password, reload, logout; budget comment (plan-review 7) |
| `context/test-plan.md` | done | TR-13 `covered (S-01)` |
| `apps/api/src/modules/health/routes.ts` | unplanned | `public: true`; logged deviation (plan-review 3) |
| `apps/api/src/infrastructure/auth/token-source.ts` | unplanned | logged deviation |
| `apps/api/test/health.int.test.ts`, `logging.int.test.ts` | unplanned | canary hashes made well-formed; logged deviation |
| `apps/web/src/App.test.tsx`, `LoginForm.test.tsx`, `api/client.test.ts` | unplanned | added per plan-review 2; logged deviation |
| `pnpm-lock.yaml`, `context/roadmap.md`, `context/changes/operator-login/{evidence/*,plan*.md}` | unplanned | lockfile, status and workflow artifacts |

## Areas
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | ok | FR-20 AC1–AC5 each have a passing test; probes confirmed 400 on a bad body, JSON 404 for unknown `/api/*`, 401 on logout without a session, cookie re-issue after an hour |
| Design | ok | ports/infrastructure split kept; guard, throttle and `Secure` rule each live in one place in `modules/auth/routes.ts` |
| Safety | ok | deny by default on the matched route, token stored as SHA-256, scrypt with constant-time compare, password never in argv, throttle cannot be bypassed by key rotation |
| Tests | concern | the sliding cookie re-issue has no test (R1) |
| Simplicity | ok | small modules; one redundant variable (R3) |
| Plan fidelity | ok | every divergence is logged under *Deviations*; plan-review findings 1–7 applied |
| Agent decisions | ok | D-1..D-12 each implemented in one place; D-6 (`Secure` never set in Docker) is stated openly and swappable in `isSecureRequest` |

## Findings
### R1: Cookie re-issue on the hourly bump is untested
- Severity: minor
- Where: `apps/api/src/modules/auth/routes.ts:61`
- Problem: the guard re-sends `lh_session` with a fresh `Max-Age` when `authenticate` bumps `last_seen_at`. Replacing that line with a comment leaves all 46 `apps/api` tests green (checked). Without it the browser drops the cookie 30 days after login even with daily use, while the server row is still valid, so "30 days of inactivity" (roadmap *Decided up front*) would silently become "30 days after login". A probe confirmed the current code does re-issue the cookie after 2 h and not on the next request.
- Fix: in `auth.int.test.ts`, with `FakeClock`, advance 2 h after login and assert `GET /api/auth/session` returns a `Set-Cookie` with `Max-Age=2592000`; a second request right after returns none.
- Effort: small
- Lesson candidate: no
- Decision: fixed (b6d1f19)

### R2: A server that is down shows the login form instead of the error
- Severity: minor
- Where: `apps/web/src/api/auth.ts:8`, `apps/web/src/App.tsx:44-46`
- Problem: `getSession()` returns `false` for any status except 200, and a network failure also leads to `setView('login')`. A 5xx or an unreachable server therefore shows "Zaloguj się", and submitting then says "Nie udało się zalogować", which suggests a credentials or login problem rather than the real state. FR-20 AC3 only asks for the login form after a 401; the test *shows the login form when the session check cannot reach the server* pins the current behaviour.
- Fix: `getSession()` returns `true` for 200, `false` for 401, and throws otherwise. `App` adds an `error` view that shows `strings.status.error` (with a retry option, or reload), and the test expects that text.
- Effort: small
- Lesson candidate: no
- Decision: fixed (9db2bc5)

### R3: Redundant hash variable in the server wiring
- Severity: minor
- Where: `apps/api/src/server.ts:45-54`
- Problem: `const hash = config.operatorPasswordHash ?? ''` is computed and then `config.operatorPasswordHash` is tested again. The `?? ''` fallback is never used, and it hides from the type checker that the verifier exists only when a hash is set.
- Fix: `const hash = config.operatorPasswordHash;` then `...(hash ? { verifier: { verify: (password) => verifyPassword(password, hash) } } : {})`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (94f7a5c)
