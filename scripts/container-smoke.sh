#!/usr/bin/env bash
# Container smoke for FR-23 AC1/AC4/AC5. Usage: scripts/container-smoke.sh [image]
# Runs the built image with plain `docker run` (no compose, no .env) and removes everything it creates.
set -euo pipefail

IMAGE="${1:-lead-hunter-ai:local}"
NAME="lh-smoke-$$"
VOLUME="lh-smoke-$$"
PORT="${SMOKE_PORT:-8082}"
BASE="http://127.0.0.1:${PORT}"
# Test-only credentials from e2e/env.ts; not a secret.
PASSWORD='e2e-test-password-DEMO'
HASH='scrypt:15:8:3:Dam3HcJsb4VKnruNqmuSyw:ie09VRIaKtgyT6wgpFvWByCSnuwayZaZy8whxIGhaCc'
JAR="$(mktemp)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -f "$JAR"
}
trap cleanup EXIT

fail() {
  echo "smoke FAILED: $*" >&2
  docker logs "$NAME" >&2 2>&1 || true
  exit 1
}

start() {
  docker run -d --name "$NAME" --init -p "127.0.0.1:${PORT}:8080" \
    -e HOST=0.0.0.0 -e LLM_PROVIDER=mock -e OPERATOR_PASSWORD_HASH="$HASH" \
    -v "$VOLUME:/data" "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    curl -fsS "$BASE/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "no healthy /api/health within 60 s"
}

echo "1/4 refuses to start without a password hash on a non-loopback HOST"
if out="$(docker run --rm -e HOST=0.0.0.0 -e OPERATOR_PASSWORD_HASH= "$IMAGE" 2>&1)"; then
  echo "$out" >&2
  fail "container started without OPERATOR_PASSWORD_HASH"
fi
grep -q 'OPERATOR_PASSWORD_HASH' <<<"$out" || { echo "$out" >&2; fail "refusal does not mention OPERATOR_PASSWORD_HASH"; }

echo "2/4 starts as non-root, applies migrations, answers /api/health"
docker volume create "$VOLUME" >/dev/null
start
health="$(curl -fsS "$BASE/api/health")"
grep -Eq '"migrations":[1-9][0-9]*' <<<"$health" || fail "no migrations applied: $health"
uid="$(docker exec "$NAME" id -u)"
[ "$uid" != "0" ] || fail "container runs as root"

echo "3/4 logs in and imports one DEMO text"
curl -fsS -c "$JAR" -H 'content-type: application/json' -d "{\"password\":\"${PASSWORD}\"}" \
  "$BASE/api/auth/login" >/dev/null || fail "login failed"
curl -fsS -b "$JAR" -H 'content-type: application/json' \
  -d '{"text":"DEMO smoke: potrzebuję strony internetowej dla małej firmy, budżet do 5000 zł"}' \
  "$BASE/api/signals/import" >/dev/null || fail "import failed"
curl -fsS -b "$JAR" "$BASE/api/opportunities" | grep -q 'DEMO smoke' || fail "imported opportunity not listed"

echo "4/4 data survives replacing the container on the same volume"
docker rm -f "$NAME" >/dev/null
start
curl -fsS -c "$JAR" -H 'content-type: application/json' -d "{\"password\":\"${PASSWORD}\"}" \
  "$BASE/api/auth/login" >/dev/null || fail "login after recreate failed"
curl -fsS -b "$JAR" "$BASE/api/opportunities" | grep -q 'DEMO smoke' || fail "opportunity lost after recreate"

echo "smoke OK"
