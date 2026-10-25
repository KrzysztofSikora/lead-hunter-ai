# Plan: pi-deployment (S-16)

## Goal and end state
The operator installs Lead Hunter AI on a Raspberry Pi 4B (64-bit Raspberry Pi OS) by following
the README alone, and it keeps running there.

- FR-23 AC1: the README install builds the image for linux/arm64 on the Pi with
  `docker compose up -d --build`. The service starts after a reboot and after a crash
  (`restart: unless-stopped`, Docker enabled at boot), publishes only `127.0.0.1:8080`, and
  keeps the database in `./data`, which survives image updates.
- FR-23 AC4 (since F-01): this change checks it in a container smoke test. The container runs
  as non-root, applies migrations, answers `/api/health`, and refuses to start without a
  password hash.
- FR-23 AC5: the README update steps (`git pull`, `docker compose up -d --build`) keep the data,
  and migrations apply. The container smoke checks this by recreating the container on the
  same volume.
- FR-23 AC2 (since F-01, `packages/config/src/env.test.ts:208`): it stays true. No variable is
  added.
- FR-23 AC3: the README documents offline behaviour, and the operator checks it on the Pi. The
  behaviour itself is already covered: failing sources are explicit errors
  (`sources.int.test.ts`, TR-09), and without `LLM_PROVIDER` analysis waits.
- FR-26 AC1: the README contains install (ARM64, Docker Compose, Tailscale serve, interim
  backup), configuration (what goes to the LLM, the access method and limits of each source)
  and a complete "Co działa / Co wymaga kluczy / Co wymaga ręcznej weryfikacji".
- NFR-01 and NFR-02: there is a repeatable way to measure them on the Pi (`deploy/pi-check.sh`
  plus a `DEMO` seed of 10 000 signals). The numbers are human checks with evidence (TR-27).
- NFR-03: already true (fetch deadlines `FETCH_TIMEOUT_MS`, `SOURCE_MAX_ATTEMPTS`). No LLM
  calls exist yet (S-05).
- NFR-04: a power loss can no longer drop commits that already succeeded (D-1). A crash during
  a run is recovered on the next start (FR-17 AC3, S-12).
- Optional `ollama` service behind a compose profile (decided up front).

## Scope
- In: the SQLite `synchronous` pragma; the `seed:demo` CLI; `deploy/pi-check.sh`; the
  `ollama` compose profile; `scripts/container-smoke.sh` with the `docker:smoke` script and a
  CI step; README and `deploy/README.md` (install, update, Tailscale serve, interim backup,
  offline, what goes to the LLM, the three-part section); test-plan rows TR-26 and TR-27.
- Out: a `systemd` unit (D-14); arm64 images built or published from CI (tech-stack: revisit if
  the Pi build is too slow); the backup command and restore (S-15); real LLM providers and the
  app actually using Ollama (S-05); changing the cookie `Secure` rule (operator-login D-6);
  `network_mode: host`.

## Findings
- Deployment files exist since F-01. In `Dockerfile:1-48`, the image is multi-stage on
  `node:24-bookworm-slim`, runs as `USER node`, creates `/data` owned by `node`, and has no
  build toolchain. The toolchain was dropped in `2da780e` (repo-skeleton R3) because
  better-sqlite3 13.0.3 ships prebuilt binaries. `docker-compose.yml:1-26` sets `init: true`,
  `restart: unless-stopped`, `env_file: .env`, `HOST=0.0.0.0`, the bind mount `./data:/data`,
  the port `127.0.0.1:8080:8080`, and a healthcheck that runs `node -e fetch(.../api/health)`.
  The base image is multi-arch, so `docker compose up --build` on the Pi builds arm64 with no
  change.
- Migrations run on start (`apps/api/src/server.ts:56-63`). An unwritable `DATA_DIR` fails with
  a Polish message (`server.ts:47-54`). The container user is `node` (uid 1000). A bind-mounted
  `./data` that a different uid created is therefore not writable. The README must say so
  (`sudo chown 1000:1000 data`).
- `openDb` (`apps/api/src/infrastructure/db/client.ts:9-15`) sets WAL, `busy_timeout` and
  `foreign_keys`, but not `synchronous`. better-sqlite3 is compiled with
  `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` (`node_modules/.pnpm/better-sqlite3@13.0.3/.../deps/defines.gypi:16`).
  In WAL mode, NORMAL keeps the database consistent after a power loss, but it can lose
  transactions committed since the last checkpoint, e.g. a payment recorded a minute earlier.
  NFR-04 allows losing only the in-flight run. See D-1.
- Shutdown on SIGTERM closes the app and SQLite (`server.ts:191-203`). `init: true` forwards
  the signal.
- NFR-01 concurrency: one cycle runs the sources one after another
  (`apps/api/src/modules/sources/service.ts:348`). A manual URL import during a run makes two
  concurrent outbound requests at most. No change needed.
- Analysis: only `LLM_PROVIDER=mock` exists (`packages/config/src/env.ts:66`). Nothing is sent
  to any LLM today. S-05 (`llm-providers`) is `todo`, so the app cannot talk to an `ollama`
  service yet.
- Cookie `Secure`: operator-login D-6 (`apps/api/src/modules/auth/routes.ts:24`) sets it only
  when the TCP peer is loopback and `X-Forwarded-Proto: https`. Behind Docker the peer is the
  bridge gateway, so behind `tailscale serve` the flag is not set. The tailnet link is
  WireGuard-encrypted. The README states this; this change does not alter the rule.
- Seeding: `ingest(tx, candidate)` (`apps/api/src/modules/signals/ingest.ts:36`) inside
  `SignalRepository.transaction` (`apps/api/src/modules/signals/ports.ts:62`) is the single
  path that creates a signal, an opportunity and evidence. `createAnalysisRunner`
  (`apps/api/src/modules/analysis/service.ts:59`) with `MockProvider` and a `dailyLimit` scores
  them. The built CLIs land in `apps/api/dist/cli/` inside the image (the README already uses
  `auth-hash.js` that way).
- The e2e test credentials `E2E_PASSWORD` / `E2E_PASSWORD_HASH` (`e2e/env.ts`) are marked
  test-only and not secret. The container smoke and the perf instance reuse them.
- Gates in the sandbox: the Docker daemon is not running here (`docker buildx ls`: cannot
  connect). Earlier runs could not build the image in the sandbox either (corepack TLS through
  the proxy: analysis-and-scoring Deviations; DNS: repo-skeleton Deviations). The image and the
  smoke are expected to run in CI.
- Ollama: `ollama/ollama` publishes multi-arch (amd64, arm64) tags. `0.40.2` was pushed on
  2026-10-08 (Docker Hub tags API, read 2026-10-25), so it is more than two weeks old. Its
  OpenAI-compatible endpoint is `http://<host>:11434/v1`.
- Tailscale: `tailscale serve --bg 8080` exposes `https://<machine>.<tailnet>.ts.net` and
  proxies to `http://127.0.0.1:8080`. It needs MagicDNS and HTTPS certificates enabled in the
  tailnet. This is `UNVERIFIED` here and becomes a human check.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | SQLite durability on power loss (NFR-04) | `synchronous = FULL` in `openDb` (one line in `client.ts`) | B: keep NORMAL (fewer fsyncs on the SD card; a power loss can lose recent commits); C: NORMAL plus a periodic `wal_checkpoint` (smaller loss window, still lossy, more code) | NFR-04 permits losing only the in-flight run. Write volume is tiny (one operator, two runs a day), so an fsync per commit costs little | cheap | agent |
| D-2 | How to get 10 000 signals for NFR-02 | CLI `apps/api/src/cli/seed-demo.ts` (`pnpm seed:demo`; in the image `node apps/api/dist/cli/seed-demo.js`). It refuses a database that already holds any opportunity, writes `DEMO`-titled synthetic signals through `ingest()` and scores them with the mock provider | B: SQL insert script (faster; bypasses identity, evidence and scoring, so the rows look nothing like real ones); C: import through `POST /api/signals/import` (exercises HTTP; 10 000 requests and throttled analysis make it slow on the Pi) | Same code path as real data, no network, and it cannot touch the operator's real data because it refuses a non-empty DB. PRD §16.1: fixtures are anonymous and `DEMO` | cheap | agent |
| D-3 | Where NFR-01/NFR-02 are measured | `deploy/pi-check.sh` with `rss` (VmRSS and VmHWM of the server process in the running `app` container; VmHWM is the peak since start, so it covers a cycle), `perf` (throwaway container `lead-hunter-perf` on `127.0.0.1:8081` with a named volume, seeded 10 000, login with the DEMO test password, 5 timed calls each to the list and Today endpoints, then removed), and `integrity` (`PRAGMA integrity_check` on the live DB) | B: `docker stats` only (counts page cache, says nothing about the node process); C: an RSS field in `GET /api/health` (changes a public contract and the OpenAPI document for a one-off measurement) | Prints text the operator pastes as evidence. Never touches `./data` except the read-only integrity check. No API change | cheap | agent |
| D-4 | How the `ollama` service looks | Compose service `ollama` with `profiles: [ollama]`, `image: ollama/ollama:0.40.2`, named volume `ollama:/root/.ollama`, no published port, `restart: unless-stopped`. The app reaches it as `http://ollama:11434/v1` once S-05 exists. README: optional, small models only (D-08), not used by the app before S-05 | B: published `127.0.0.1:11434` (lets the host's CLI use it; another open port); C: model files under `./data` (one directory to back up; GBs of models in the backups of S-15) | Decided up front by the user. Not started without `--profile ollama`. Lesson: the docs must not claim the app uses it yet | cheap | user (roadmap S-16) + agent (shape) |
| D-5 | How FR-23 AC1/AC4/AC5 are checked automatically | `scripts/container-smoke.sh` (root script `docker:smoke`), run in the CI `image` job after the build and added to the CLAUDE.md Gates table. Steps: (1) starting with `HOST=0.0.0.0` and no hash exits non-zero with `OPERATOR_PASSWORD_HASH` in stderr; (2) start with the DEMO hash on a named volume, wait for `/api/health` 200 with `migrations > 0`, check `id -u` is not 0; (3) log in and import one DEMO text; (4) remove the container and start a new one on the same volume, so the opportunity is still listed. It uses `docker run`, never `docker compose`, so it needs no `.env`, and it removes its container and volume | B: smoke through `docker compose` (also covers the compose file; needs a `.env` in the repo root, which a run must not write); C: no smoke, human check only (no automated proof for AC4/AC5) | The test plan's image row promised this "e2e-in-container check of S-16". It writes nothing into the repo (lesson: a gate run must not rewrite committed files). The compose properties (restart policy, 127.0.0.1, healthcheck) stay a human check plus `docker compose config` | cheap | agent |
| D-6 | arm64 build verification | On the Pi only (human check: build time, success). There is no arm64 job in CI | B: CI `docker buildx --platform linux/arm64` under QEMU (catches arm64-only build breaks; 15+ minutes per PR, a new CI tool) | Tech-stack *Deployment* chose the build on the Pi and "revisit if too slow". The base image and better-sqlite3 prebuilds are multi-arch | cheap | research (tech-stack) |
| D-7 | Interim backup before S-15 | README: `docker compose stop`, copy `data/lead-hunter.db*` to a dated directory outside the repo, `docker compose start` (a cold copy is consistent) | B: nothing until S-15 (FR-26 AC1 lists backup in install); C: online backup now (that is S-15's scope) | Meets FR-26 AC1 without pulling S-15 forward. S-15 replaces the section | cheap | agent |
| D-8 | Test proof for this item's ACs | The container smoke (D-5) covers FR-23 AC1 (volume), AC4 and AC5. AC2 is covered by the existing `env.test.ts`. AC3 and NFR-04 recovery are covered by the existing S-10/S-12 integration tests. FR-26, NFR-01 and NFR-02 are human checks with evidence. There are no new Vitest tests | B: a unit test that `openDb` sets `synchronous` (config wiring; the test budget forbids it); C: a Vitest timing test over 10 000 rows (sandbox timing does not predict the Pi; flaky) | Test budget: TR-26/TR-27 are `human`, and no `test` risk belongs to S-16 | cheap | prd (test-plan budget) |

## Design
- **Durability (D-1):** `openDb` adds `sqlite.pragma('synchronous = FULL')` after
  `journal_mode = WAL`. It applies to the server and to every CLI, because all of them use
  `openDb`.
- **Seed (D-2):** `seed-demo.ts [--count N]`. The default is 10 000, the range is 1–50 000, and
  any other value exits 1 with a Polish message.
  - Load config with `loadConfigOrExit()`, open `${DATA_DIR}/lead-hunter.db`, run migrations.
  - If any opportunity exists, print `baza nie jest pusta — seed:demo działa tylko na pustej
    bazie` and exit 1.
  - Generate N candidates deterministically from index `i`:
    - `sourceType: 'manual'`, `sourceId: null`, `externalId: null`, `sourceUrl: null`,
      `canonicalUrl: null`;
    - title `DEMO <i>: <phrase>`;
    - a snippet built from fixed fictional phrase lists (budget, stack, remote/onsite, Polish
      and English), so the mock analysis gives a spread of categories and scores;
    - `contentHash` from the existing helper;
    - `at` and `publishedAt` spread over the last 25 days, so the pre-filter's 30-day rule
      keeps them.
  - Insert in transactions of 500 through `repository.transaction((tx) => ingest(tx, c))`.
  - Then run `createAnalysisRunner` with `MockProvider`, `dailyLimit: N` and the real clock:
    `kick()`, then `await idle()`.
  - Print `zapisano N sygnałów DEMO, przeanalizowano M` and the elapsed seconds.
  - Root and api `package.json` get the script `seed:demo`, same shape as `discover`.
- **Measurement (D-3):** `deploy/pi-check.sh <rss|perf|integrity>`, bash with `set -euo
  pipefail`. It uses only `docker`, `curl` and the node binary in the image.
  - `rss`: `docker compose exec app node -e` scans `/proc/[0-9]*/cmdline` for `server.js` and
    prints that process's `VmRSS` and `VmHWM` in MB. The README tells the operator to restart
    the container, click *Uruchom teraz*, wait for the run to finish, then call `rss`.
  - `perf [count]`:
    - `docker volume create lead-hunter-perf`, then `docker run -d --name lead-hunter-perf
      --init -p 127.0.0.1:8081:8080 -e HOST=0.0.0.0 -e OPERATOR_PASSWORD_HASH=<E2E hash>
      -e LLM_PROVIDER=mock -v lead-hunter-perf:/data lead-hunter-ai:local`;
    - wait for health, then `docker exec ... node apps/api/dist/cli/seed-demo.js --count N`;
    - `POST /api/auth/login` with the DEMO password (the exact route is taken from the auth
      module) into a cookie jar;
    - 5× `curl -w '%{time_total}'` for `GET /api/opportunities`, `GET
      /api/opportunities?minScore=65` and `GET /api/digest/today`, printing max and median in
      ms;
    - a `trap` removes the container and the volume.
  - `integrity`: `docker compose exec -w /app/apps/api app node -e` opens `/data/lead-hunter.db`
    read-only with better-sqlite3 and prints `PRAGMA integrity_check`.
- **Compose (D-4):** a new `ollama` service and a top-level `volumes: { ollama: {} }`. The
  `app` service is unchanged: no `depends_on`, because the profile is optional.
- **Container smoke (D-5):** `scripts/container-smoke.sh [image]`, defaulting to
  `lead-hunter-ai:local`. The project names `lh-smoke-<pid>` keep it unique. It waits up to
  60 s for health. On any failure it prints `docker logs` and exits 1. The CI `image` job runs
  `pnpm docker:smoke` after `pnpm docker:build`.
- **Error model:** the scripts print one Polish (operator-facing `pi-check.sh`) or English (CI
  smoke) line per failure and exit non-zero. `seed-demo` exits 1 on bad args or a non-empty DB.

## Phases
### Phase 1: Durability, DEMO seed and Pi measurement script
- Files:
  - `apps/api/src/infrastructure/db/client.ts`: add `synchronous = FULL`. Contract: every
    connection from `openDb` uses WAL + FULL (D-1).
  - `apps/api/src/cli/seed-demo.ts` (new): the seed CLI. Contract: `--count N` (1–50 000,
    default 10 000); exits 1 on a database with any opportunity; titles start with `DEMO`
    (D-2).
  - `apps/api/package.json`, `package.json`: script `seed:demo`. Contract: a new root command.
  - `deploy/pi-check.sh` (new, executable): `rss | perf [count] | integrity` (D-3).
  - `CLAUDE.md`: a *Commands* row for `pnpm seed:demo`.
- Proves: NFR-04 durability setting (no test, D-8); the tooling for the NFR-01/NFR-02 human
  checks.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
  - `DATA_DIR=$(mktemp -d) pnpm seed:demo --count 10000` prints the summary. A second call on
    the same dir exits 1 with the non-empty message.
  - Start the built app on that dir (`pnpm build`; `DATA_DIR=… OPERATOR_PASSWORD_HASH=<E2E
    hash> LLM_PROVIDER=mock pnpm start`), log in, and time the three endpoints with curl.
    Write the result to `context/changes/pi-deployment/evidence/sandbox-timing.txt`, labelled
    "sandbox amd64, not the Pi". If any endpoint takes over 500 ms here, record a `[REVIEW]`
    deviation; do not add indexes in this phase.
  - `bash -n deploy/pi-check.sh`.
- Human checks: none (the Pi runs are in Phase 3).

### Phase 2: Ollama profile and container smoke in CI
- Files:
  - `docker-compose.yml`: the `ollama` service behind `profiles: [ollama]` and the named
    volume `ollama` (D-4). Contract: plain `docker compose up` starts only `app`.
  - `scripts/container-smoke.sh` (new, executable): the four steps of D-5. Contract: exit 0
    only if all pass; it leaves no container or volume behind.
  - `package.json`: script `docker:smoke` (`bash scripts/container-smoke.sh`).
  - `.github/workflows/ci.yml`: the `image` job runs `pnpm docker:smoke` after
    `pnpm docker:build`.
  - `CLAUDE.md`: a Gates row `image smoke | pnpm docker:smoke | Docker, after pnpm
    docker:build` and a *Commands* row.
  - `context/test-plan.md`: the image row of *Test levels* names `pnpm docker:smoke`. TR-26 →
    `covered (S-16: container-smoke; Pi build human)`.
- Proves: FR-23 AC1 (data kept on a volume across container replacement), AC4 (non-root,
  migrations, health, refusal without a hash) and AC5 (recreate keeps data, migrations
  re-apply). Level: image (CI).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`; `bash -n
  scripts/container-smoke.sh`.
  - Compose files must parse: `cp .env.example` to a temp file, then `docker compose
    --env-file /dev/null -f docker-compose.yml config -q` (both without a profile and with
    `--profile ollama`). If `env_file: .env` is missing in the sandbox, run in a temp copy of
    the repo with a copied `.env.example` as `.env`, and never write `.env` in the working
    tree.
  - If the Docker daemon is available: `pnpm docker:build && pnpm docker:smoke`. Otherwise
    record a `[minor]` deviation and leave it to the CI `image` job.
- Human checks: none (CI result is read at the PR).

### Phase 3: Raspberry Pi install and operator docs
- Files:
  - `README.md`: rewrite the *Uruchomienie* and *Dostęp zdalny* sections into a Pi install,
    in Polish:
    - prerequisites: 64-bit Raspberry Pi OS, Docker via the official Debian instructions,
      `usermod -aG docker`, `systemctl enable docker`;
    - `git clone`; `mkdir -p data && sudo chown 1000:1000 data`; `.env` from `.env.example`
      plus the hash;
    - `docker compose up -d --build` (arm64 build on the Pi, expected minutes);
    - check: `docker compose ps` healthy, `curl 127.0.0.1:8080/api/health`;
    - *Aktualizacja* (`git pull`, `docker compose up -d --build`, data kept, migrations on
      start);
    - *Dostęp zdalny* (`tailscale serve --bg 8080`, tailnet HTTPS/MagicDNS prerequisite, the
      `Secure` cookie consequence of operator-login D-6);
    - *Kopia zapasowa (tymczasowo, do S-15)* (D-7);
    - *Bez internetu* (what works offline, FR-23 AC3);
    - *Opcjonalnie: Ollama* (D-4: profile command, small models only, not used before S-05);
    - *Pomiary na Raspberry Pi* (`deploy/pi-check.sh`).
    - Configuration: *Co trafia do LLM* (today nothing, mock only; S-05 will list the
      prompt parts per FR-24 AC3) and a pointer to `docs/source-policy.md` for access method
      and limits.
    - Rewrite *Co działa / Co wymaga kluczy / Co wymaga ręcznej weryfikacji* to cover every
      done item, including Today (S-13), scheduler and run history (S-12) and pipeline and
      payments (S-08). Fix the stale status line ("szkielet repozytorium (F-01)").
  - `deploy/README.md`: replace the "dojdą ze slice'em S-16" stub with the file roles
    (Dockerfile, compose, `ollama` profile, `pi-check.sh`, `container-smoke.sh`) and a link to
    the README install.
  - `context/test-plan.md`: TR-27 → `planned (S-16 human checks, evidence in
    changes/pi-deployment/evidence/)`.
- Proves: FR-26 AC1 (doc review); FR-23 AC1, AC3 and AC5 in the operator's hands (human).
- Agent checks: `pnpm lint` (prettier over Markdown), `pnpm test`.
  - Every command and path in the new README sections exists: grep the package scripts and
    files named; `docker compose --profile ollama config -q` as in Phase 2.
- Human checks (on the Pi, evidence into `context/changes/pi-deployment/evidence/`):
  - Install from the README on a clean 64-bit Raspberry Pi OS. Record the build time of
    `docker compose up -d --build` and whether better-sqlite3 needed a source build;
    `docker compose ps` shows `healthy`.
  - `sudo reboot`, then within 2 minutes `docker compose ps` is healthy and the panel opens.
  - `docker kill -s KILL <app container>` during *Uruchom teraz*. The container comes back by
    itself, the run history shows the interrupted run as failed, and `deploy/pi-check.sh
    integrity` prints `ok` (NFR-04).
  - `ss -tlnp | grep 8080` shows only `127.0.0.1:8080`.
  - The scheduled 08:00 or 18:00 run appears in the run history without anyone touching it.
  - `deploy/pi-check.sh rss` after a discovery cycle: VmHWM ≤ 500 MB (NFR-01).
  - `deploy/pi-check.sh perf 10000`: max ≤ 500 ms for each endpoint (NFR-02).
  - Offline: unplug the network or `sudo ip link set wlan0 down`; the panel over LAN or the
    console, a text import, a status change and a payment work, and *Uruchom teraz* shows each
    source as an error, not as "no results" (FR-23 AC3).
  - `tailscale serve --bg 8080` from the README: the panel opens on the phone at
    `https://<machine>.<tailnet>.ts.net` and login works.
  - `git pull && docker compose up -d --build` keeps existing opportunities (FR-23 AC5).
  - Read the README install as the operator: the steps are complete and in the right order;
    the three-part section is accurate (FR-26 AC1).

## Risks and unknowns
- **arm64 build on the Pi** (TR-26): the risk is a missing better-sqlite3 prebuild for Node 24
  arm64. The build would then fall back to `node-gyp` and fail, because the toolchain is gone
  since R3. Mitigation: the human check records it. If it fails, the fix is one `apt-get
  install python3 make g++` line in the `build` and `prod-deps` stages (a `[FOLLOW-UP]` or a
  PR fix, not done blind).
- **Docker daemon is unavailable in the sandbox**, so the image and smoke cannot run locally
  and the CI `image` job is the first real run of `container-smoke.sh`. Keep the script plain
  bash + curl so review can read it.
- **Seed speed on the Pi:** 10 000 mock analyses may take minutes. That is acceptable for a
  one-off measurement, and `perf` prints the elapsed time.
- **`synchronous = FULL` on an SD card** slows each commit by one fsync. Writes are rare. If the
  Pi measurements show slow writes, D-1 B is one line.
- **Tailscale serve syntax** changed across versions (`--bg` since 1.52). The README names the
  minimum version, and the human check confirms it.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Durability, DEMO seed and Pi measurement script
- [ ] Phase 2: Ollama profile and container smoke in CI
- [ ] Phase 3: Raspberry Pi install and operator docs

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [REVIEW] plan-review #1 (major): `docker kill` counts as a manual stop, so `unless-stopped` would
  not restart the container. The Phase 3 crash check kills the server process inside the
  container instead (`docker compose exec app sh -c 'kill -9 $(pgrep -f dist/server.js)'`, or
  `sudo kill -9` of the host pid from `docker top`); tini then exits non-zero and the restart
  policy applies. The Phase 3 human check and README wording use this.
- [REVIEW] plan-review #2 (major): the seed CLI calls `createProfileService(...).ensureExample()`
  before the runner and reads the profile with `profile: { get: () => service.get().profile }`
  (as `server.ts` does). It exits 1 if any analysis ended `FAILED` or not every signal was
  analysed, so the evidence never measures unscored rows.
- [minor] plan-review #3: `perf` seeds with `docker run --rm -v lead-hunter-perf:/data ...` before
  the perf server starts, so no second runner competes (Phase 1 script).
- [minor] plan-review #5: seeded rows use `sourceType: 'manual_text'` with `publishedAt: null`
  (the plan's `'manual'` is not a `SourceType`), shaped like real manual imports.
- [minor] plan-review #4: the container smoke's recreate step is worded in Phase 2 and the README
  as "data kept, start on a migrated DB"; new migrations on upgrade stay covered by the migration
  integration test and the human `git pull` check.
- [minor] plan-review #6, #7: FR-23 AC1 "backups" belongs to S-15; the interim copy goes under
  `data/backups/` (Phase 3 checks `.gitignore` covers `data/`), and Phase 3 adds a per-adapter
  table to the README.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
