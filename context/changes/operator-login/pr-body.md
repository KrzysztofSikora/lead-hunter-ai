# feat(operator-login): operator password login with sessions, deny-by-default API guard and login throttle

Roadmap item S-01 (Operator login). The panel now shows a Polish login form until the operator logs in, and has a logout button afterwards. Every `/api/*` route except `GET /api/health` and `POST /api/auth/login` requires a session. Sessions are stored server-side with a 30-day idle limit, and several devices can be logged in at once. Login is throttled to 5 attempts per 15 minutes. `pnpm auth:hash` creates the password hash for `.env`. Covers PRD FR-20 AC1–AC5.
Closes #2

> **Status:** Ready for review

## ⚠ Needs your decision
Full table: [`plan.md#decisions`](context/changes/operator-login/plan.md#decisions). The costly ones, most important first:

- **D-6 (costly): `Secure` cookie flag.** The `Secure` flag is set only when the TCP peer is loopback and `X-Forwarded-Proto` is `https` (as decided up front in the roadmap). **In Docker the peer is the bridge gateway, never loopback, so `Secure` is not set in the container deployment.** The tailnet link is WireGuard-encrypted, and `HttpOnly` + `SameSite=Strict` still apply. Alternatives: B: also trust private-range peers when `HOST` is non-loopback; C: a `TRUSTED_PROXIES` env variable. Switching costs: one function (`isSecureRequest` in `apps/api/src/modules/auth/routes.ts`), plus B/C change the README note. The gateway-peer finding could not be checked in the sandbox (see Human checks).
- **D-4 (costly): login throttle with one global key.** `@fastify/rate-limit`, 5 attempts per 15 minutes, in memory, reset on restart. Anyone who can reach the login route can lock the operator out for 15 minutes. Alternatives: B: per-IP key (every request has the same peer behind Tailscale/Docker, and trusting `X-Forwarded-For` allows key rotation); C: own failure-only counter with backoff (no dependency). Switching costs: the route config in `modules/auth/routes.ts`, and removing the dependency for C.
- **D-1 (costly): custom hash format.** `scrypt:<ln>:<r>:<p>:<salt>:<hash>` (base64url, default ln=15, r=8, p=3) instead of a PHC string, because Docker Compose interpolates `$` in `.env`. It is a persisted config format. Alternatives: B: PHC string `$scrypt$…` (would need quoting or escaping in `.env`); C: ln=17, p=1 (128 MiB per login on a 4 GB Pi). Switching costs: `PASSWORD_HASH_PATTERN` in `packages/config`, `scrypt-password.ts`, and re-hashing the operator's password.
- **D-2 (costly): loopback start without a hash.** The server starts and auth stays **on**: protected routes answer 401 and login answers 503 `auth_not_configured`. Alternatives: B: no auth on loopback without a hash (easier dev, but `tailscale serve` → 127.0.0.1 would expose an open panel); C: refuse to start without a hash everywhere (contradicts FR-20 AC1). Switching costs: config validation, the login route and the 503 UI string.
- **D-3 (costly): session storage.** `sessions` table keeping only the SHA-256 of a random token; 30 days idle; `last_seen_at` bumped at most once per hour. Alternatives: B: raw token in the DB; C: stateless signed cookie (logout could not invalidate it). Switching costs: migration `0001_*`, the repository and the service.
- **D-5 (costly): deny-by-default guard.** One root `onRequest` hook; matched `/api/*` routes need a session unless the route config says `public: true`. The guard decides on `request.routeOptions.url`, not the raw URL, after plan-review finding 1 (percent-encoded `/%61pi/...` bypass; covered by a test). Unknown `/api/*` stays JSON 404. Alternatives: B: per-route `preHandler`; C: 401 for unknown `/api/*` too (would change three F-01 tests).
- **D-7, D-8 (costly, public API / cookie):** `POST /api/auth/login`, `POST /api/auth/logout` and `GET /api/auth/session` with `{ error: <code> }` bodies; cookie `lh_session`, `Path=/`, `HttpOnly`, `SameSite=Strict`, 30-day `Max-Age`, unsigned. Alternatives: D-7 B: login returns a session object, C: `DELETE /api/auth/session`; D-8 B: signed cookie, C: `__Host-` prefix (needs `Secure`).
- **[FOLLOW-UP] sessions survive a hash change.** Changing `OPERATOR_PASSWORD_HASH` (e.g. after a lost phone) keeps existing sessions until they idle out. Decide whether it belongs in the next slice (see Follow-ups).
- **Plan review / review leftovers:** none open. Plan review was READY WITH NOTES (2 major, 5 minor; all applied). Review round 1 was APPROVE (R1–R3, all fixed).

Reply in a review comment, e.g. `D-6: take B`, `D-4: take C`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 1) `pnpm auth:hash` in a terminal: the password is not echoed, a mismatch is refused, and the printed line pasted into `.env` lets `HOST=0.0.0.0 pnpm start` start. Run: `pnpm auth:hash`, then `HOST=0.0.0.0 pnpm start`. Evidence: [`auth-hash-output.txt`](context/changes/operator-login/evidence/auth-hash-output.txt) (piped run only; the TTY prompt needs a person).
- [ ] (Phase 3) Polish wording and look of the login form at phone width and on a laptop. Run: `pnpm build`, then `HOST=127.0.0.1 OPERATOR_PASSWORD_HASH=$(pnpm --silent auth:hash) pnpm start`, open http://127.0.0.1:8080/. Evidence: [`login-360.png`](context/changes/operator-login/evidence/login-360.png), [`shell-360.png`](context/changes/operator-login/evidence/shell-360.png).
- [ ] (Phase 3) Docker behind `tailscale serve` (or on the Pi): log in from the phone over `https://<host>.<tailnet>.ts.net`; check in dev tools whether `lh_session` has `Secure` (expected not set in Docker, D-6); still logged in after a day; logout on the phone leaves the laptop logged in. Run: `docker compose up --build`. Evidence: none.

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-9 | `pnpm auth:hash` input | Hidden TTY prompt (twice) or first stdin line; never argv; min 12 characters; does not load app config | Password as argument; generate a random password |
| D-10 | UI structure for login | No router; `App` state `checking / login / ready` (plus `error` after R2), fetch wrapper turns 401 into the login view | Add react-router now |
| D-11 | Test hash for e2e | Committed hash of a test-only password in `e2e/env.ts` | Compute the hash in `playwright.config.ts` |
| D-12 | Clock for session expiry | `Clock` port in `modules/auth/ports.ts`, fake clock in tests | Shared `shared/clock.ts` now |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (122/122), e2e ok (2/2, Chromium via `E2E_CHROMIUM_PATH`). **Image not run:** `pnpm install` inside the sandbox build fails with `SELF_SIGNED_CERT_IN_CHAIN` (environment, not the change); the CI `image` job is the authority.
- Review: APPROVE, round 1: fixed 3 (R1 cookie re-issue test, R2 error view instead of login form when the session check fails, R3 redundant hash variable), deferred 0, rejected 0.
- Mutation: skipped: S-01 is not a mutation target (`context/changes/operator-login/mutation.md` not produced); `bug` mutants: none.
- Proposed lessons: none.

## Follow-ups
- **[FOLLOW-UP]** Invalidate all sessions when `OPERATOR_PASSWORD_HASH` changes (fingerprint of the hash in `app_meta`), or offer "log out everywhere". Not in S-01's acceptance.
- Out of scope by plan: password change UI, Tailscale setup docs and verification on the Pi (S-16), multi-user (NG-06).
- Minor note: the "401 from a later call → login view" path is covered at the `apiFetch` level only, since no web call uses `apiFetch` yet; S-02 is its first user.

## Commits
```
62b1d6f docs(operator-login): place R2 deviation under Deviations
0b0150a docs(operator-login): triage review round 1
94f7a5c fix(operator-login): drop the redundant hash fallback in the server wiring (R3)
9db2bc5 fix(operator-login): show the server error, not the login form, when the session check fails (R2)
b6d1f19 fix(operator-login): test the hourly cookie re-issue (R1)
0bd3bce docs(operator-login): review
32a31ec feat(operator-login): login form, logout and e2e login flow
d46416c feat(operator-login): sessions, auth API, deny-by-default guard and login throttle
d4e17e4 feat(operator-login): password hash format, pnpm auth:hash and config validation
0b9b1f2 docs(operator-login): plan-review
16ff21e docs(operator-login): plan
```

<details><summary>Run</summary>

Ship operator-login (S-01), base main, branch change/operator-login, started 2026-10-25T09:45:48+00:00. No failed step, no draft reason.

| Step | Attempt | Model | Cost | Result |
|------|---------|-------|------|--------|
| plan | 1 | opus | $1.59 | success |
| plan-review | 1 | opus | $0.73 | READY WITH NOTES |
| implement (phase 1) | 1 | sonnet | $0.36 | success |
| implement (phase 2) | 1 | sonnet | $0.51 | success |
| implement (phase 3) | 1 | sonnet | $0.36 | success |
| review | 1 | opus | $1.20 | APPROVE, 3 findings |
| fix-review | 1 | sonnet | $0.23 | success, 0 open findings |

Total listed cost: about $4.98. Phases ticked: 3/3.
</details>

