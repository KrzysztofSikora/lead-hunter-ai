#!/usr/bin/env bash
# Container smoke for FR-23 AC1/AC4/AC5 and FR-22 AC2. Usage: scripts/container-smoke.sh [image]
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
  docker rm -f "$NAME" "$NAME-nohash" >/dev/null 2>&1 || true
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

echo "1/5 refuses to start without a password hash on a non-loopback HOST"
rc=0
out="$(timeout 60 docker run --rm --name "$NAME-nohash" -e HOST=0.0.0.0 -e OPERATOR_PASSWORD_HASH= "$IMAGE" 2>&1)" || rc=$?
if [ "$rc" = 0 ] || [ "$rc" = 124 ]; then
  echo "$out" >&2
  fail "container started without OPERATOR_PASSWORD_HASH"
fi
grep -q 'OPERATOR_PASSWORD_HASH' <<<"$out" || { echo "$out" >&2; fail "refusal does not mention OPERATOR_PASSWORD_HASH"; }

echo "2/5 starts as non-root, applies migrations, answers /api/health"
docker volume create "$VOLUME" >/dev/null
start
health="$(curl -fsS "$BASE/api/health")"
grep -Eq '"migrations":[1-9][0-9]*' <<<"$health" || fail "no migrations applied: $health"
uid="$(docker exec "$NAME" id -u)"
[ "$uid" != "0" ] || fail "container runs as root"

echo "3/5 logs in and imports one DEMO text"
curl -fsS -c "$JAR" -H 'content-type: application/json' -d "{\"password\":\"${PASSWORD}\"}" \
  "$BASE/api/auth/login" >/dev/null || fail "login failed"
curl -fsS -b "$JAR" -H 'content-type: application/json' \
  -d '{"text":"DEMO smoke: potrzebuję strony internetowej dla małej firmy, budżet do 5000 zł"}' \
  "$BASE/api/signals/import" >/dev/null || fail "import failed"
curl -fsS -b "$JAR" "$BASE/api/opportunities" | grep -q 'DEMO smoke' || fail "imported opportunity not listed"

echo "4/5 data survives replacing the container on the same volume"
docker rm -f "$NAME" >/dev/null
start
curl -fsS -c "$JAR" -H 'content-type: application/json' -d "{\"password\":\"${PASSWORD}\"}" \
  "$BASE/api/auth/login" >/dev/null || fail "login after recreate failed"
curl -fsS -b "$JAR" "$BASE/api/opportunities" | grep -q 'DEMO smoke' || fail "opportunity lost after recreate"

echo "5/5 backup, then restore it in place with the README steps"
docker exec "$NAME" node apps/api/dist/cli/backup.js >/dev/null || fail "backup command failed"
curl -fsS -c "$JAR" -H 'content-type: application/json' -d "{\"password\":\"${PASSWORD}\"}" \
  "$BASE/api/auth/login" >/dev/null || fail "login before restore failed"
curl -fsS -b "$JAR" -H 'content-type: application/json' \
  -d '{"text":"DEMO after backup: potrzebuję sklepu internetowego, budżet do 7000 zł"}' \
  "$BASE/api/signals/import" >/dev/null || fail "second import failed"
docker stop "$NAME" >/dev/null
# Same steps as the README: move lead-hunter.db* aside, copy the newest backup, start again.
docker run --rm --entrypoint sh -v "$VOLUME:/data" "$IMAGE" -c '
  set -e
  newest="$(ls /data/backups/lead-hunter-*.db | sort | tail -n 1)"
  mkdir /data/before-restore
  mv /data/lead-hunter.db* /data/before-restore/
  cp "$newest" /data/lead-hunter.db
' || fail "restore steps failed"
docker rm -f "$NAME" >/dev/null
start
health="$(curl -fsS "$BASE/api/health")"
grep -Eq '"migrations":[1-9][0-9]*' <<<"$health" || fail "restored instance reports no migrations: $health"
curl -fsS -c "$JAR" -H 'content-type: application/json' -d "{\"password\":\"${PASSWORD}\"}" \
  "$BASE/api/auth/login" >/dev/null || fail "login after restore failed"
list="$(curl -fsS -b "$JAR" "$BASE/api/opportunities")"
grep -q 'DEMO smoke' <<<"$list" || fail "restored data lacks the backed-up opportunity"
! grep -q 'DEMO after backup' <<<"$list" || fail "restored data still has the post-backup opportunity"

echo "smoke OK"
