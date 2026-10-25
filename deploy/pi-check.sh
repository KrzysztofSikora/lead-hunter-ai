#!/usr/bin/env bash
# Pomiary na Raspberry Pi (NFR-01, NFR-02, NFR-04). Użycie: deploy/pi-check.sh rss | perf [liczba] | integrity
# Uruchamiaj z katalogu repozytorium. Wynik wklej jako dowód przy PR.
set -euo pipefail

IMAGE="${IMAGE:-lead-hunter-ai:local}"
# Dane testowe z e2e/env.ts: hasło tylko do testów, nie jest sekretem.
DEMO_PASSWORD='e2e-test-password-DEMO'
DEMO_HASH='scrypt:15:8:3:Dam3HcJsb4VKnruNqmuSyw:ie09VRIaKtgyT6wgpFvWByCSnuwayZaZy8whxIGhaCc'
PERF_NAME=lead-hunter-perf
PERF_PORT=8081

die() {
  echo "błąd: $*" >&2
  exit 1
}

rss() {
  docker compose exec -T app node -e '
    const fs = require("node:fs");
    for (const pid of fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n))) {
      let cmd = "";
      try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch { continue; }
      const args = cmd.split("\0");
      if (Number(pid) === process.pid || !args[0].endsWith("node") || args[1] !== "apps/api/dist/server.js") continue;
      const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const mb = (key) => Math.round(Number(new RegExp(key + ":\\s+(\\d+) kB").exec(status)[1]) / 1024);
      console.log(`pid ${pid}: VmRSS ${mb("VmRSS")} MB, VmHWM (szczyt od startu) ${mb("VmHWM")} MB; cel NFR-01: VmHWM <= 500 MB`);
      process.exit(0);
    }
    console.error("nie znaleziono procesu server.js");
    process.exit(1);
  ' || die "pomiar pamięci nie powiódł się — czy kontener app działa (docker compose ps)?"
}

integrity() {
  docker compose exec -T -w /app/apps/api app node -e '
    const Database = require("better-sqlite3");
    const db = new Database("/data/lead-hunter.db", { readonly: true });
    const rows = db.pragma("integrity_check");
    console.log("integrity_check: " + rows.map((r) => r.integrity_check).join("; "));
    process.exit(rows.length === 1 && rows[0].integrity_check === "ok" ? 0 : 1);
  ' || die "integrity_check nie zwrócił ok"
}

median_max() {
  sort -n | awk '{ v[NR] = $1 } END { printf "mediana %d ms, max %d ms", v[int((NR + 1) / 2)] * 1000, v[NR] * 1000 }'
}

perf() {
  local count="${1:-10000}"
  local base="http://127.0.0.1:${PERF_PORT}"
  JAR="$(mktemp)"
  cleanup() {
    docker rm -f "$PERF_NAME" >/dev/null 2>&1 || true
    docker volume rm "$PERF_NAME" >/dev/null 2>&1 || true
    rm -f "$JAR"
  }
  trap cleanup EXIT
  cleanup
  docker volume create "$PERF_NAME" >/dev/null

  echo "seed: $count sygnałów DEMO (to może potrwać kilka minut na Pi)"
  docker run --rm -v "$PERF_NAME:/data" -e LLM_PROVIDER=mock \
    -e OPERATOR_PASSWORD_HASH="$DEMO_HASH" "$IMAGE" \
    node apps/api/dist/cli/seed-demo.js --count "$count" || die "seed nie powiódł się"

  docker run -d --name "$PERF_NAME" --init -p "127.0.0.1:${PERF_PORT}:8080" \
    -e HOST=0.0.0.0 -e LLM_PROVIDER=mock -e OPERATOR_PASSWORD_HASH="$DEMO_HASH" \
    -v "$PERF_NAME:/data" "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    curl -fsS "$base/api/health" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fsS "$base/api/health" >/dev/null || die "serwer testowy nie odpowiada"
  curl -fsS -c "$JAR" -H 'content-type: application/json' \
    -d "{\"password\":\"${DEMO_PASSWORD}\"}" "$base/api/auth/login" >/dev/null ||
    die "logowanie do serwera testowego nie powiodło się"

  echo "cel NFR-02: max <= 500 ms przy $count sygnałach"
  local path
  for path in '/api/opportunities' '/api/opportunities?minScore=65' '/api/digest/today'; do
    local times=""
    for _ in 1 2 3 4 5; do
      times+="$(curl -fsS -b "$JAR" -o /dev/null -w '%{time_total}' "${base}${path}")"$'\n'
    done
    printf '%-36s %s\n' "$path" "$(printf '%s' "$times" | median_max)"
  done
}

case "${1:-}" in
  rss) rss ;;
  perf) perf "${2:-10000}" ;;
  integrity) integrity ;;
  *) die "użycie: deploy/pi-check.sh rss | perf [liczba] | integrity" ;;
esac
