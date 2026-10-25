# Wdrożenie

Instalacja krok po kroku: [`README.md`](../README.md), sekcja *Instalacja na Raspberry Pi 4B*.

| Plik | Rola |
|------|------|
| `Dockerfile` | obraz wieloetapowy na `node:24-bookworm-slim`, działa jako użytkownik `node`, migracje bazy przy starcie |
| `docker-compose.yml` | usługa `app`: `restart: unless-stopped`, port `127.0.0.1:8080`, wolumen `./data:/data`, healthcheck na `/api/health` |
| `docker-compose.yml`, profil `ollama` | opcjonalna usługa Ollama (`docker compose --profile ollama up -d`), bez portu na hoście; aplikacja łączy się z nią przez `LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL=http://ollama:11434/v1` |
| `deploy/pi-check.sh` | pomiary na Pi: `rss`, `perf [liczba]` (jednorazowy kontener z sygnałami `DEMO`, nie dotyka `./data`), `integrity` |
| `scripts/container-smoke.sh` | test obrazu (`pnpm docker:smoke`, w CI po `pnpm docker:build`): użytkownik nie-root, migracje, `/api/health`, odmowa startu bez skrótu hasła, dane zostają po wymianie kontenera |

Obrazu arm64 nie buduje CI; buduje go Raspberry Pi (`docker compose up -d --build`).
