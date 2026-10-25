# Plan: operator-login (S-01)

## Goal and end state
Every `/api/*` route except `GET /api/health` and `POST /api/auth/login` requires a valid
operator session; the panel shows a Polish login form until the operator logs in and has a
logout button afterwards.

Observable when done:
- FR-20 AC1: with the default config the server listens on `127.0.0.1` (already true since
  F-01; the existing config test stays and covers it).
- FR-20 AC2: a non-loopback `HOST` without a **valid** password hash refuses to start with a
  clear Polish message. The D-4 placeholder from repo-skeleton no longer passes (see D-1).
- FR-20 AC3: every registered `/api/*` route except health and login answers 401
  `{ "error": "unauthorized" }` without a session (a test walks the route table); the UI then
  shows the login form.
- FR-20 AC4: after 5 login attempts in 15 minutes further attempts get 429 with `Retry-After`;
  the session cookie is `HttpOnly` and `SameSite=Strict`; after logout the old cookie gets 401.
- FR-20 AC5: health stays public and unchanged (F-01 tests keep covering it).
- `pnpm auth:hash` prints a scrypt hash for `.env`; it also works inside the container.
- Sessions expire after 30 days of inactivity; several devices may hold sessions at once
  (roadmap *Decided up front*).

## Scope
- In: password hash format and `pnpm auth:hash`; config validation of the hash; `sessions`
  table and migration; auth service, login/logout/session routes, deny-by-default guard, login
  throttle, cookie flags (incl. `Secure` behind Tailscale per *Decided up front*); contracts and
  OpenAPI for the new routes; login form, logout and 401 handling in the UI; e2e smoke extended
  with login; `.env.example`, README.
- Out: password change UI, "log out all devices", invalidating sessions when the hash changes
  (`[FOLLOW-UP]`, see *Risks*); Tailscale setup docs and verification on the Pi (S-16);
  multi-user (NG-06); CSRF tokens (SameSite=Strict covers the single-origin SPA, see *Findings*).

## Findings
- Config: `packages/config/src/env.ts:30-38` refuses a non-loopback `HOST` when
  `OPERATOR_PASSWORD_HASH` is empty, but accepts any non-empty value (repo-skeleton D-4;
  `context/changes/repo-skeleton/plan.md:431` asks S-01 to tighten the format). Test
  `packages/config/src/env.test.ts:123` ("accepts 0.0.0.0 with a hash") uses a placeholder and
  must switch to a well-formed hash.
- App wiring: `apps/api/src/app.ts:24` `buildApp(deps)` registers health and, outside
  production, a hidden `GET /api/openapi.json` (`app.ts:45`). `deps.onRoute` (`app.ts:20`) is
  the hook the OpenAPI test uses; the route-table 401 test reuses it. Infrastructure is only
  wired in `server.ts` and injected (`eslint.config.js:66-77`); only a module's `routes.ts` may
  import Fastify (`eslint.config.js:56-64`).
- Tests that call protected routes without a session today and must log in first (behaviour
  kept, not weakened): `apps/api/test/openapi.int.test.ts:24` (serves the document outside
  production). Unknown `/api/*` paths stay JSON 404 (D-5), so
  `apps/api/test/health.int.test.ts:36` and `apps/api/test/static.int.test.ts:24-40` keep
  passing unchanged.
- Test helper `apps/api/test/helpers/app.ts:34` `buildTestApp` builds the app on a migrated
  temp DB; the test plan's cookbook already names `app.loginAsOperator()` (`context/test-plan.md`
  *Add an integration test*), which this change adds.
- Schema: only `app_meta` (`apps/api/src/infrastructure/db/schema.ts`); migrations are
  generated with `pnpm --filter @lead-hunter/api db:generate` into `apps/api/migrations/`.
- Logging already redacts `req.headers.cookie`, `res.headers["set-cookie"]` and `password` keys
  (`apps/api/src/infrastructure/logging/logger.ts:13-18`), so the session cookie and the login
  body never reach logs; Fastify does not log bodies by default.
- e2e: `playwright.config.ts:26-34` starts the built server on `127.0.0.1` without a hash; the
  smoke spec (`e2e/smoke.spec.ts`) opens `/` and checks the shell. The budget allows at most 2
  specs, so login goes into the smoke spec.
- Web: no router or query library yet (`apps/web/package.json`); `App.tsx` fetches health once.
- **@fastify/rate-limit 11.2.1** (README in the npm tarball): `global: false` plus a per-route
  `config.rateLimit: { max, timeWindow, keyGenerator }`; in-memory `LocalStore` by default;
  counts every request, successes included (no "skip successful" option);
  `errorResponseBuilder(request, context)` returns an object that is **thrown** as the error, so
  it must carry `statusCode: 429`; `context.ttl` is the remaining window in ms; it sets
  `retry-after`. Dependencies: `@lukeed/ms`, `ip-address`, `toad-cache`, `fastify-plugin`.
- **@fastify/cookie 11.1.3**: `request.cookies`, `reply.setCookie(name, value, opts)`,
  `reply.clearCookie(name, opts)`; `sameSite: 'strict'`, `httpOnly`, `secure`, `maxAge`
  (seconds), `path`. Signing needs a `secret`; not used (D-8).
- **Docker Compose interpolates `$` in `env_file` values** (unless `format: raw`), and the PHC
  string format (`$scrypt$ln=...`) would be mangled in `.env`. Hence D-1 uses `:` separators and
  base64url, which contain neither `$`, `#`, quotes nor `=` padding.
- **Peer address in Docker.** With `ports: 127.0.0.1:8080:8080` the container sees connections
  from the bridge gateway (e.g. `172.18.0.1`, via docker-proxy or DNAT), never from loopback.
  Tailscale serve → host 127.0.0.1 → container therefore never looks "loopback" inside the
  container. Consequence in D-6. Not verifiable in the sandbox (no Docker build, see
  repo-skeleton deviations); it becomes a human check.
- `node:crypto` `scrypt` rejects `128 * N * r` ≥ `maxmem` (default 32 MiB), so N=2^15, r=8 needs
  an explicit `maxmem` (D-1). OWASP Password Storage Cheat Sheet lists N=2^15, r=8, p=3 as an
  equivalent of its scrypt minimum.
- Fastify lifecycle hooks must be added before the routes they guard are registered (Hooks
  reference); `buildApp` registers the auth guard first. `request.is404` tells the guard that no
  route matched.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Password hash format and cost | `scrypt:<log2 N>:<r>:<p>:<salt>:<hash>` with base64url salt (16 bytes) and key (32 bytes); default `ln=15, r=8, p=3`, `maxmem` 64 MiB. Verification reads the parameters from the string. `packages/config` validates the shape with one exported pattern; a malformed value (incl. the old placeholder) fails at start with a message that names `pnpm auth:hash` | B: PHC string `$scrypt$ln=15,r=8,p=1$…` (a recognised standard, but Compose interpolates `$` in `.env`); C: `ln=17, p=1` (OWASP's first line, but 128 MiB per login on a 4 GB Pi) | Survives `.env` and Compose unchanged; 32 MiB per login is fine on the Pi; parameters in the string allow raising the cost later without breaking old hashes | costly (security, config format) | agent |
| D-2 | Loopback start without a password hash | Server starts (AC1 default config), auth stays **on**: protected routes answer 401 and login answers 503 `{ "error": "auth_not_configured" }`; the login form explains how to set the hash | B: no auth on loopback without a hash (no setup in dev, but `tailscale serve` → 127.0.0.1 would expose an open panel, against brief §16.2); C: refuse to start without a hash everywhere (simplest, but contradicts AC1 "default config starts") | Secure by default in the Tailscale deployment the user chose, and AC1 still holds | costly (security) | agent |
| D-3 | Session storage and expiry | Table `sessions(token_hash TEXT PK, created_at INTEGER, last_seen_at INTEGER)`, times as UTC epoch ms. The cookie holds a random 32-byte base64url token; the DB stores only its SHA-256. Valid while `now − last_seen_at < 30 days`; `last_seen_at` is bumped (and the cookie re-issued) at most once per hour; expired rows are deleted on each successful login | B: store the raw token (one hash less, but a copied DB gives live sessions); C: stateless signed cookie (no table, but logout cannot invalidate it, AC4) | Logout really invalidates; a leaked backup does not log anyone in; hourly bump keeps SD-card writes low | costly (persisted data shape, auth) | agent |
| D-4 | Login throttle | `@fastify/rate-limit` (tech-stack), `global: false`, only on `POST /api/auth/login`: one key for all clients, 5 attempts per 15 minutes, then 429 `{ "error": "too_many_attempts", "retryAfterSeconds" }` and `Retry-After`. In memory, resets on restart | B: per-IP key (the default; but behind Tailscale/Docker every request has the same peer, and trusting `X-Forwarded-For` would let an attacker rotate keys); C: own failure-only counter with exponential backoff (no dependency, successes not counted, ~40 lines) | Tech-stack names the plugin; a single key cannot be bypassed; one operator rarely logs in 5 times in 15 minutes. Cost: anyone with network access can lock the operator out for 15 minutes | costly (new runtime dependency, security) | agent |
| D-5 | How routes are protected | One root `onRequest` hook, deny by default: every matched route whose URL starts with `/api/` needs a session unless its route config says `public: true`; only health and login set it. Unmatched `/api/*` stays JSON 404; static files and the SPA shell stay public | B: per-route `preHandler` (explicit, but a forgotten route is open); C: 401 also for unknown `/api/*` paths (hides which routes exist, but the repo is public anyway and three F-01 tests would change) | A new route is protected without anyone remembering to; the route-table test proves it | costly (security) | agent |
| D-6 | `Secure` cookie flag | `Secure` when the TCP peer is loopback (`127.0.0.0/8`, `::1`, `::ffff:127.*`) and the first `X-Forwarded-Proto` value is `https`. Fastify `trustProxy` stays off, so `request.ip` is always the socket peer. One function decides | B: also trust peers in private ranges when `HOST` is non-loopback (makes `Secure` work in Docker, where the peer is the bridge gateway); C: `TRUSTED_PROXIES` env (most flexible, one more variable) | Follows the user's decision literally. **Consequence:** in the Docker deployment the peer is never loopback, so `Secure` is not set there; the tailnet link is WireGuard-encrypted and `SameSite=Strict`+`HttpOnly` still apply. Choosing B or C changes one function | costly (security) | user (roadmap S-01) + agent (Docker consequence) |
| D-7 | Auth API contract | `POST /api/auth/login` `{ password }` → 204 + cookie, 401 `{ error: "invalid_password" }`, 429, 503; `POST /api/auth/logout` (session required) → 204, row deleted, cookie cleared; `GET /api/auth/session` → 200 `{ authenticated: true }` or the guard's 401. Error bodies follow F-01's `{ error: <code> }` | B: login returns 200 with a session object (expiry etc.; nothing in the UI needs it yet); C: `DELETE /api/auth/session` for logout (more RESTful, less obvious in the UI code) | Smallest public surface; the UI only needs "logged in or not" | costly (public API) | agent |
| D-8 | Cookie details | Name `lh_session`, `Path=/`, `HttpOnly`, `SameSite=Strict`, `Max-Age` 30 days, unsigned | B: signed cookie (needs a `COOKIE_SECRET`; adds nothing, the token is random and checked server-side); C: `__Host-` prefix (stronger scoping, but requires `Secure`, which plain-HTTP loopback and Docker lack) | Fewest secrets; works over plain HTTP on loopback | costly (auth) | agent |
| D-9 | `pnpm auth:hash` input | Hidden prompt on a TTY (asked twice, must match); first line of stdin when piped; never from argv (shell history). Minimum 12 characters. Prints only the hash. Does not load the app config, so `docker compose run --rm --no-deps app node apps/api/dist/cli/auth-hash.js` works without a valid `.env` | B: password as an argument (simplest, but lands in shell history); C: also generate a random password (handy, but the operator must store it somewhere) | Safe default for a secret; usable on a Pi with only Docker | cheap | agent |
| D-10 | UI structure for login | No router yet: `App` holds `checking / login / ready`; a small fetch wrapper turns any 401 into the login view; the shell gets a logout button | B: add react-router now (tech-stack has it, but there is one view) | Smallest change; S-02+ add routing when there are views | cheap | agent |
| D-11 | Test password hash for e2e | A committed hash of a test-only password in `e2e/env.ts`, passed to the e2e server as `OPERATOR_PASSWORD_HASH`; the smoke spec logs in, reloads, logs out | B: compute the hash in `playwright.config.ts` (no committed constant, but duplicates the hash format outside the API) | The test plan names `e2e/env.ts`; the value is not a secret | cheap | agent |
| D-12 | Clock for session expiry | `Clock` port (`now(): Date`) in `modules/auth/ports.ts`, system clock wired in `server.ts`, fake clock in tests | B: a shared `apps/api/src/shared/clock.ts` now (later slices need it too, but no second user yet) | Test plan requires a Clock port; the first user owns it until a second one appears | cheap | agent |

## Design

### Hash (`apps/api/src/infrastructure/auth/scrypt-password.ts`)
- `hashPassword(password: string, params?: ScryptParams): Promise<string>` → `scrypt:15:8:3:<salt>:<key>`.
- `verifyPassword(password: string, encoded: string): Promise<boolean>`: parse, run scrypt with
  the stored parameters and `maxmem = 256 * N * r` (at least 64 MiB), compare with
  `timingSafeEqual`. A malformed string throws (it was validated at start, so this is a bug).
- `PASSWORD_HASH_PATTERN` lives in `packages/config` (used by the env schema and the parser):
  `^scrypt:\d{1,2}:\d{1,2}:\d{1,2}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$`.

### Auth module (`apps/api/src/modules/auth/`)
- `ports.ts`: `SessionRepository { create(row), find(tokenHash), touch(tokenHash, at), delete(tokenHash), deleteIdleSince(cutoff) }`,
  `PasswordVerifier { verify(password): Promise<boolean> }` (bound to the configured hash),
  `Clock`, `TokenSource { newToken(): string }`.
- `service.ts` `createAuthService(deps)`:
  - `login(password)` → `{ ok: true, token } | { ok: false, reason: 'invalid_password' | 'not_configured' }`; sweeps idle sessions.
  - `authenticate(token)` → `{ valid: false } | { valid: true, refreshCookie: boolean }`; enforces
    the 30-day idle limit, bumps `last_seen_at` hourly.
  - `logout(token)`.
  - Tokens are hashed with SHA-256 (`node:crypto` `createHash`) before every repository call.
    The module layer may import `node:crypto`: it is not in the lint rule's driver list
    (`eslint.config.js:7-16`).
- `routes.ts` `registerAuth(app, deps)`: registers `@fastify/cookie`, `@fastify/rate-limit`
  (`global: false`), the guard hook (D-5), the three routes (D-7) and the `Secure` rule (D-6).
  Route config type: declaration merge `FastifyContextConfig { public?: boolean }`.
- `app.ts`: `AppDeps` gains `auth: AuthDeps`; `registerAuth` runs before every other route.

### Contracts (`packages/contracts/src/auth.ts`)
`LoginRequest { password: string (1–1024) }`, `SessionResponse { authenticated: true }`,
`ApiError { error: string }`, `ThrottledError { error: 'too_many_attempts', retryAfterSeconds: number }`.

### Error model
| Case | Status | Body |
|------|--------|------|
| no/invalid/expired session on a protected route | 401 | `{ error: "unauthorized" }` |
| wrong password | 401 | `{ error: "invalid_password" }` |
| throttled | 429 + `Retry-After` | `{ error: "too_many_attempts", retryAfterSeconds }` |
| no hash configured (loopback only) | 503 | `{ error: "auth_not_configured" }` |
| invalid body | 400 | Fastify/Zod validation error (FR-25 AC1 pattern) |

### Data
Migration `0001_*`: `sessions` as in D-3. No foreign keys. Nothing else changes.

## Phases

### Phase 1: Password hash, `pnpm auth:hash` and config validation
- Files:
  - `packages/config/src/env.ts`: `OPERATOR_PASSWORD_HASH` must match `PASSWORD_HASH_PATTERN`
    when set; message `nieprawidłowy format — wygeneruj hash poleceniem pnpm auth:hash`. The
    non-loopback refusal stays. Contract: exported `PASSWORD_HASH_PATTERN`; `Config` unchanged.
  - `packages/config/src/env.test.ts`: the "accepts 0.0.0.0 with a hash" case uses a well-formed
    hash; add "refuses a malformed hash" (the old placeholder). FR-20 AC2.
  - `apps/api/src/infrastructure/auth/scrypt-password.ts`: `hashPassword`, `verifyPassword` (D-1).
  - `apps/api/src/infrastructure/auth/scrypt-password.test.ts`: round trip; wrong password →
    false; hash with other stored parameters still verifies; two hashes of the same password
    differ (salt). Uses low-cost parameters (`ln=10`) for speed. TR-13.
  - `apps/api/src/cli/auth-hash.ts`: D-9. Does not call `loadConfigOrExit`.
  - `apps/api/package.json`: script `auth:hash` (same `node --conditions=source --import tsx`
    form as `discover`); root `package.json`: `"auth:hash": "pnpm --filter @lead-hunter/api auth:hash"`.
  - `apps/api/test/cli.int.test.ts`: piped password → stdout is one line matching the pattern
    and it verifies; a password shorter than 12 characters exits 1 (extend the existing CLI test
    file; one case each).
  - `.env.example`: `OPERATOR_PASSWORD_HASH` comment explains `pnpm auth:hash`, the Docker form,
    and that without it login is disabled (D-2). Remove the "only presence is checked" note.
  - `README.md`: setup step uses `pnpm auth:hash` or the `docker compose run` form instead of
    the placeholder.
- Proves: FR-20 AC2 (unit, config); hash correctness (unit); `pnpm auth:hash` (integration via
  the CLI).
- Agent checks: `pnpm typecheck`, `pnpm lint`,
  `pnpm vitest run packages/config apps/api/src/infrastructure/auth apps/api/test/cli.int.test.ts`, `pnpm test`.
- Human checks: run `pnpm auth:hash` in a terminal: the password is not echoed, a mismatch is
  refused, the printed line pasted into `.env` lets `pnpm start` with `HOST=0.0.0.0` start.

### Phase 2: Sessions, auth API, guard and throttle
- Files:
  - `apps/api/package.json`: add `@fastify/cookie` 11.1.3 and `@fastify/rate-limit` 11.2.1
    (exact pins, per tech-stack).
  - `apps/api/src/infrastructure/db/schema.ts` + generated `apps/api/migrations/0001_*.sql`
    (+ meta): `sessions` (D-3).
  - `apps/api/src/infrastructure/db/session-repository.ts`: Drizzle implementation of
    `SessionRepository`.
  - `apps/api/src/modules/auth/ports.ts`, `service.ts`, `routes.ts`: as in *Design*.
  - `packages/contracts/src/auth.ts` + `index.ts` export: the schemas above.
  - `apps/api/src/app.ts`: `AppDeps.auth`; `registerAuth` first; health route and the OpenAPI
    route: health marked `public: true`. Contract: `buildApp(deps)` requires `deps.auth`.
  - `apps/api/src/server.ts`: wires repository, verifier (from `config.operatorPasswordHash`),
    system clock and token source.
  - `apps/api/test/helpers/app.ts`: `buildTestApp` accepts `clock` and wires auth with a
    low-cost test hash of `TEST_PASSWORD`; exports `loginAsOperator(app)` → cookie header.
  - `apps/api/test/auth.int.test.ts` (TR-13, FR-20 AC3/AC4):
    1. every registered route (collected via `onRoute`, `HEAD` skipped) except health and login
       answers 401 without a cookie and with a made-up cookie;
    2. login with the right password → 204, `Set-Cookie` has `HttpOnly`, `SameSite=Strict`,
       `Path=/`, `Max-Age`, no `Secure`; `GET /api/auth/session` with it → 200;
    3. `Secure` set for `x-forwarded-proto: https` from `127.0.0.1`, not from `10.0.0.5`
       (`inject({ remoteAddress })`);
    4. logout → 204; the same cookie → 401;
    5. 5 wrong logins → 401 each; the 6th (even with the right password) → 429 with
       `Retry-After` and `retryAfterSeconds`;
    6. fake clock: session used 29 days later → 200; idle for 30 days → 401;
    7. no hash configured → login 503 `auth_not_configured`, protected route 401;
    8. the DB holds no raw token (row's `token_hash` ≠ cookie value).
  - `apps/api/test/openapi.int.test.ts`: "serves the document outside production" logs in first
    (the route is now protected); the route-vs-document test then also covers the auth routes.
- Proves: FR-20 AC3 (API side), AC4 (integration, real SQLite via `inject`), FR-25 AC3 still
  green.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run apps/api`, `pnpm test`.
- Human checks: none (the browser flow is checked in Phase 3).

### Phase 3: Login form, logout, e2e and docs
- Files:
  - `apps/web/src/api/client.ts`: `apiFetch(path, init)`; on 401 calls a registered
    `onUnauthorized` handler and throws `UnauthorizedError`. Contract: every later web API call
    goes through it.
  - `apps/web/src/api/auth.ts`: `getSession()`, `login(password)` → `'ok' | 'invalid' |
    { throttled: seconds } | 'not_configured'`, `logout()`; parses bodies with the contracts.
  - `apps/web/src/LoginForm.tsx` (+ styles in `App.module.css`): password field with label,
    submit button, error line with `role="alert"`; works at 360 px.
  - `apps/web/src/App.tsx`: D-10 state machine; logout button in the shell; health status stays.
  - `apps/web/src/strings.pl.ts`: `login.*` strings — title "Zaloguj się", label "Hasło",
    button "Zaloguj", errors "Nieprawidłowe hasło.", "Za dużo prób. Spróbuj ponownie za
    {minuty} min.", "Logowanie jest wyłączone: ustaw OPERATOR_PASSWORD_HASH (polecenie
    pnpm auth:hash) i uruchom serwer ponownie.", "Wyloguj".
  - `e2e/env.ts`: `E2E_PASSWORD` and its hash (D-11). `playwright.config.ts`: passes the hash.
  - `e2e/smoke.spec.ts`: at 360×740 — `/` shows the login form; a wrong password shows the
    error; the right one shows the shell with "Serwer działa"; reload keeps the session; logout
    returns to the form. Screenshots to `context/changes/operator-login/evidence/login-360.png`
    and `shell-360.png`. The health-over-HTTP test stays.
  - `README.md`: *Co działa* lists login/logout and throttle; *Co wymaga ręcznej weryfikacji*
    lists the `Secure` flag behind Tailscale (D-6); a short "Dostęp zdalny" note:
    `tailscale serve` → `127.0.0.1:8080`, details in S-16.
  - `context/test-plan.md`: TR-13 status `covered (S-01)`.
- Proves: FR-20 AC3 (UI shows the login form, e2e), AC4 logout in the browser (e2e).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`.
- Human checks:
  - Polish wording and look of the login form on a phone-width window and a laptop
    (`pnpm build && pnpm start` with a hash from `pnpm auth:hash`; evidence `login-360.png`).
  - In Docker behind `tailscale serve` (or on the Pi): log in from the phone over
    `https://<host>.<tailnet>.ts.net`, check in dev tools whether the cookie has `Secure`
    (expected **not** set in Docker, D-6), stays logged in after a day, and logout from the
    phone does not log out the laptop.

## Risks and unknowns
- **D-6 in Docker:** `Secure` will not be set in the container deployment. If the reviewer wants
  it, take D-6 option B (one function). Also verify the gateway-peer finding in the human check.
- **Throttle lock-out (D-4):** a single key means anyone who reaches the login route can block
  the operator for 15 minutes; it also resets on restart. Acceptable for a tailnet/LAN-only app.
- **Rate-limit error with the Zod serializer:** the thrown 429 object must match the declared
  429 response schema, or serialization fails with 500. Test 5 catches it.
- **Phase 2 size** may exceed ~400 lines (migration meta JSON is generated and large). If the
  hand-written part exceeds it, `/implement` may split repository+service from routes (`[minor]`).
- **Hash change does not end sessions.** Changing `OPERATOR_PASSWORD_HASH` (e.g. after a lost
  phone) keeps existing sessions until they idle out. `[FOLLOW-UP]`: on start, compare a
  fingerprint of the hash in `app_meta` and delete all sessions when it changed, or add "log out
  everywhere".
- Docker build and Chromium download are blocked in the sandbox (repo-skeleton deviations); the
  CI `image` and `e2e` jobs remain the authority.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Password hash, `pnpm auth:hash` and config validation
- [x] Phase 2: Sessions, auth API, guard and throttle
- [x] Phase 3: Login form, logout, e2e and docs

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 1) `pnpm auth:hash` on a terminal: password not echoed, mismatch refused, printed line pasted into `.env` lets `HOST=0.0.0.0 pnpm start` start — run: `pnpm auth:hash` then `HOST=0.0.0.0 pnpm start` — evidence: context/changes/operator-login/evidence/auth-hash-output.txt (piped run only; the TTY prompt needs a person)

- [ ] (Phase 3) Polish wording and look of the login form at phone width and on a laptop — run: `pnpm build`, then `HOST=127.0.0.1 OPERATOR_PASSWORD_HASH=$(pnpm --silent auth:hash) pnpm start`, open http://127.0.0.1:8080/ — evidence: context/changes/operator-login/evidence/login-360.png, shell-360.png
- [ ] (Phase 3) Docker behind `tailscale serve` (or on the Pi): log in from the phone over `https://<host>.<tailnet>.ts.net`, check in dev tools whether `lh_session` has `Secure` (expected not set in Docker, D-6), still logged in after a day, logout on the phone leaves the laptop logged in — run: `docker compose up --build` — evidence: none

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] Phase 1: plan-review finding 4 applied: `packages/config` bounds the hash parameters (ln 10–20, r 1–32, p 1–16) after the pattern match; tests cover out-of-range values. The existing canary hashes in `health.int.test.ts` and `logging.int.test.ts` became well-formed hashes (they still contain `LEAK-CANARY`), since a placeholder no longer passes config.
- [minor] Phase 1: plan-review finding 5 applied: `.env.example` and README say the Docker form needs an existing (possibly empty) `.env`.
- [minor] Phase 2: plan-review finding 1/3/6 applied: the guard decides on `request.routeOptions.url` (test `/%61pi/auth/session` → 401), `modules/health/routes.ts` is marked `public: true`, and the route-table test substitutes `:param` with a dummy value.
- [minor] Phase 2: plan says the thrown rate-limit object becomes the 429 body; code shows Fastify's default error handler replaces it (and adds `statusCode`), so serialization failed with 500. Consequence: the login route lives in a child plugin with its own error handler that rebuilds the `ThrottledError` body; other errors are rethrown to the default handler. Added `infrastructure/auth/token-source.ts` (the `TokenSource` implementation) which the plan did not list.
- [minor] Phase 3: plan-review finding 2 applied: `App.test.tsx` routes the fetch stub by URL; added `LoginForm.test.tsx` (invalid, 429 minutes with rounding, 503, unexpected answer) and `api/client.test.ts` (401 → handler). The 401-from-a-later-call → login view path is covered at the `apiFetch` level only, since no web call uses `apiFetch` yet (health is public, auth calls need to read 401 themselves); S-02 is its first user. Finding 7 applied as a comment in `e2e/env.ts`.
- [minor] Phase 3: a failed logout request keeps the shell (the session is still alive) instead of showing the form; a 401 on logout counts as success.
- [FOLLOW-UP] Invalidate all sessions when `OPERATOR_PASSWORD_HASH` changes, or offer "log out
  everywhere" (see *Risks*). Not in S-01's acceptance.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
