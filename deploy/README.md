# Wdrożenie

Pliki wdrożeniowe leżą w katalogu głównym repozytorium: `Dockerfile` (obraz wieloetapowy,
uruchamiany jako użytkownik `node`, migracje bazy przy starcie) oraz `docker-compose.yml`
(port `127.0.0.1:8080`, wolumen `./data:/data`, healthcheck na `/api/health`).

Uwagi o Raspberry Pi i Tailscale (dostęp spoza sieci lokalnej, kopie zapasowe) dojdą tutaj
razem ze slice'em S-16.
