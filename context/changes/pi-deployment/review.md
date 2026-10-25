# Review: pi-deployment

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok, e2e ok, image not run (no Docker daemon in the sandbox), image smoke not run (no Docker daemon) · Round: 2

## Round 2 (re-review after `/fix-review`, commit 3ff6a9e)

| Finding | Check | Result |
|---------|-------|--------|
| R1 | `deploy/pi-check.sh:24-25` now splits the cmdline on NUL and requires `args[0]` ending in `node` and `args[1] === "apps/api/dist/server.js"`; skips its own pid; prints the measured pid. Ran the predicate: `docker-init -- node apps/api/dist/server.js` false, `node apps/api/dist/server.js` true, `node -e ...server.js` false. Matches the Dockerfile `CMD ["node", "apps/api/dist/server.js"]` with `WORKDIR /app` | fixed |
| R2 | `JAR` is now a global set before `trap cleanup EXIT`; the same pattern under `set -euo pipefail` exits 0 | fixed |
| R3 | `scripts/container-smoke.sh:41-46` wraps the no-hash run in `timeout 60`, treats exit 0 and 124 as "started", and `cleanup` removes `$NAME-nohash`. The server handles SIGTERM (`apps/api/src/server.ts:202`), so the signal the docker CLI proxies stops it; `timeout` returns 124 | fixed |
| R4 | README offline paragraph and the Phase 3 human check now say "on the Pi (local browser or `ssh -L`)", port loopback-only | fixed |

No new findings in the fix commit. `bash -n` passes for both scripts. The image and image-smoke gates
still have not run here (no Docker daemon); CI runs them, and the Pi checks remain human checks.

## Round 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `apps/api/src/infrastructure/db/client.ts` | done | `synchronous = FULL` after WAL (D-1) |
| `apps/api/src/cli/seed-demo.ts` | done | D-2 plus plan-review #2 and #5 (logged deviations): `ensureExample()`, `manual_text`, `publishedAt: null`, exit 1 unless all N are COMPLETE. Ran it here: 50 rows seeded and analysed, second call refused, `--count 0` refused |
| `apps/api/package.json`, `package.json` | done | `seed:demo`, `docker:smoke` |
| `deploy/pi-check.sh` | done | D-3 with plan-review #3 (seed before the server starts). `rss` picks the wrong process (R1); `perf` exits 1 after a successful run (R2) |
| `docker-compose.yml` | done | `ollama` behind a profile, `ollama/ollama:0.40.2` (checked on Docker Hub: amd64 + arm64, pushed 2026-10-08) |
| `scripts/container-smoke.sh` | done | The four D-5 steps. Step 1 has no time limit (R3) |
| `.github/workflows/ci.yml` | done | `pnpm docker:smoke` after `pnpm docker:build` |
| `CLAUDE.md` | done | Gates row and two Commands rows |
| `context/test-plan.md` | done | image row, TR-26, TR-27, the gate table, CI line |
| `README.md` | done | Pi install, update, Tailscale, interim backup, offline, Ollama, measurements, per-adapter table, three-part section. The offline paragraph claims LAN access (R4) |
| `deploy/README.md` | done | file roles and a link to the README |
| `context/changes/pi-deployment/evidence/sandbox-timing.txt` | done | Phase 1 agent check, labelled "sandbox amd64, not the Pi" |
| `context/roadmap.md` | unplanned | workflow status (in-progress, now review) |
| `context/changes/pi-deployment/{plan,plan-review}.md` | unplanned | workflow artifacts |

## Areas (round 1; round 2: all ok)
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | fail | `pi-check.sh rss` measures `docker-init` instead of the server under compose `init: true` (R1); `perf` exits 1 on success (R2) |
| Design | ok | Seed goes through `ingest()` and the real runner; scripts are plain bash with `docker run`, no `.env` written |
| Safety | ok | Test-only DEMO hash, refusal on a non-empty DB, no port published for Ollama, perf never touches `./data` |
| Tests | concern | No new Vitest by budget (D-8); the container smoke has never run (no Docker here) and can hang instead of failing (R3) |
| Simplicity | ok | Small, readable scripts; one pragma line |
| Plan fidelity | ok | Every planned file changed as described; deviations logged |
| Agent decisions | ok | D-1…D-8 each live in one place and are cheap to reverse as stated |

## Findings
### R1: `pi-check.sh rss` reports the memory of `docker-init`, not of the server
- Severity: blocker
- Where: `deploy/pi-check.sh:24`
- Problem: the scan takes the first pid in `/proc` whose cmdline merely contains `server.js`. `docker-compose.yml` sets `init: true`, so pid 1 in the `app` container is `/sbin/docker-init -- node apps/api/dist/server.js`; its cmdline contains `server.js` and it comes first in `/proc` order. The script therefore prints the RSS/HWM of tini (about 1 MB) and the NFR-01 human check (`VmHWM <= 500 MB`) passes whatever the server uses: false evidence. The scan also matches its own `node -e` process (the script text contains `server.js`) and any shell wrapping it; reproduced here: the same loop run on the host matched its parent `bash -c` process, not a server.
- Fix: match on argv, not on a substring: `const args = cmd.split("\0"); if (pid === "1" || Number(pid) === process.pid || !(args[0].endsWith("node") && args[1] === "apps/api/dist/server.js")) continue;` (or just require `args[0]` to be `node` and `args[1]` to be the server path). Print the pid with the result so the evidence shows which process was measured.
- Effort: small
- Lesson candidate: Identify a process by its exact argv, never by a substring of its cmdline, when an init wrapper or the probe itself can carry the same text.
- Decision: fixed (3ff6a9e)

### R2: `pi-check.sh perf` exits 1 after a successful run and leaks the cookie jar
- Severity: major
- Where: `deploy/pi-check.sh:51-60`
- Problem: `jar` is `local` to `perf`, but `cleanup` runs from the `EXIT` trap after `perf` has returned. Under `set -u` the `rm -f "$jar"` line then fails with `jar: unbound variable`, the script exits 1 and the temp file stays behind. Reproduced with a minimal copy of the pattern (`local jar; trap cleanup EXIT` under `set -euo pipefail`): output `jar: unbound variable`, `exit=1`. The operator sees an error after the timings print, and a wrapper checking the exit status treats the measurement as failed. The container and volume are still removed, because those lines run before the failing one.
- Fix: make `jar` a global (`JAR=` at the top, like `container-smoke.sh`), or use `rm -f "${jar:-}"`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (3ff6a9e)

### R3: container smoke step 1 hangs instead of failing if the image starts without a hash
- Severity: minor
- Where: `scripts/container-smoke.sh:41`
- Problem: the refusal check is a foreground `docker run --rm ...` with no time limit. The regression this step guards against (the server starting on `0.0.0.0` without `OPERATOR_PASSWORD_HASH`) makes the server run forever, so the CI `image` job hangs until the job timeout instead of printing `container started without OPERATOR_PASSWORD_HASH`.
- Fix: `out="$(timeout 60 docker run --rm --name "$NAME-nohash" ...)"`, treat exit 124 as "started" and `docker rm -f "$NAME-nohash"` in `cleanup`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (3ff6a9e)

### R4: README offline section says the panel works over LAN, but the port is loopback-only
- Severity: minor
- Where: `README.md:108` (and the matching Phase 3 human check in `plan.md`)
- Problem: "Panel (LAN lub konsola) ... działają bez internetu". The compose file publishes only `127.0.0.1:8080` and the README itself says the server is reachable remotely only through `tailscale serve`; a browser on another LAN machine cannot reach it. The operator following the offline check would conclude something is broken (CLAUDE.md: truth first).
- Fix: say "na Pi (przeglądarka lokalna albo `ssh -L 8080:127.0.0.1:8080 pi`)" or, if a tailnet peer on the same LAN still works offline, say that and leave it as a human check; adjust the human-check wording to match.
- Effort: small
- Lesson candidate: no
- Decision: fixed (3ff6a9e)
