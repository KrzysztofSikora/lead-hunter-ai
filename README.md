# Lead Hunter AI

Self-hosted service for a solo software/AI/IoT studio: it finds real demand signals from
permitted sources, scores them with explicit rules and prepares offer drafts that the operator
reviews and sends by hand. Target: Raspberry Pi 4B (Linux ARM64), running 24/7.

Status: szkielet repozytorium (F-01). Działa serwer z `/api/health`, baza z migracjami i pusta
powłoka interfejsu; źródła, analiza i punktacja dojdą w kolejnych slice'ach.
Product brief: [`lead-hunter-ai-PRD.md`](lead-hunter-ai-PRD.md).
Development follows the spec-driven workflow in [`docs/workflow.md`](docs/workflow.md);
the roadmap is tracked as GitHub issues.

## Uruchomienie

```sh
mkdir -p data
cp .env.example .env
# w .env ustaw OPERATOR_PASSWORD_HASH: wynik polecenia `pnpm auth:hash` albo, tylko z Dockerem,
# `docker compose run --rm --no-deps app node apps/api/dist/cli/auth-hash.js` (potrzebuje istniejącego .env)
docker compose up --build
```

Sprawdź: <http://127.0.0.1:8080/api/health>. Interfejs: <http://127.0.0.1:8080/>.
Baza leży w `data/lead-hunter.db` (poza repozytorium). Więcej: [`deploy/README.md`](deploy/README.md).

## Rozwój

```sh
pnpm install
pnpm dev          # API (8080) + Vite
pnpm typecheck && pnpm lint && pnpm test
pnpm e2e          # wymaga: pnpm exec playwright install chromium
pnpm docker:build
```

Baza deweloperska: `apps/api/data/lead-hunter.db`. Migracje: `pnpm db:migrate`.

## Co działa / Co wymaga kluczy / Co wymaga ręcznej weryfikacji

- **Co działa:** serwer, `GET /api/health`, migracje Drizzle, OpenAPI poza produkcją, redakcja
  sekretów w logach, polska powłoka UI, `pnpm discover` (brak źródeł); logowanie operatora
  (hasło w `OPERATOR_PASSWORD_HASH`, sesja w ciasteczku `HttpOnly` + `SameSite=Strict` ważna 30 dni
  bez aktywności, wylogowanie, limit 5 prób na 15 minut); każdy `/api/*` poza health i logowaniem
  wymaga sesji; profil operatora (`GET`/`PUT /api/profile`, widok *Profil* w UI, przykładowy profil
  z etykietą `PRZYKŁAD` przy pierwszym uruchomieniu); błędy walidacji ciała żądania mają jeden
  kształt `{ error: "validation_failed", fields }`.
- **Co wymaga kluczy:** nic w tej chwili; klucze LLM i skrzynka IMAP dojdą ze slice'ami S-04 i S-11.
- **Co wymaga ręcznej weryfikacji:** uruchomienie `docker compose up` na Raspberry Pi
  (czas budowania better-sqlite3 na ARM64), wygląd powłoki i formularza logowania na telefonie,
  flaga `Secure` ciasteczka za Tailscale (w Dockerze serwer widzi adres bramy, nie loopback,
  więc flaga nie jest ustawiana; patrz decyzja D-6 w `context/changes/operator-login/plan.md`).

## Dostęp zdalny

Serwer domyślnie słucha tylko na `127.0.0.1`. Zdalnie: `tailscale serve` kierujące na
`127.0.0.1:8080` (szczegóły i weryfikacja na Raspberry Pi: slice S-16).
