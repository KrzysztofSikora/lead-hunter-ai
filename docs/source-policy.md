# Polityka źródeł

Lista adapterów źródeł: sposób dostępu, regulamin, limity i to, co zapisujemy (FR-26 AC2).
Źródła czytamy tylko przez dostęp oficjalny lub dozwolony; nie omijamy CAPTCHA ani limitów.
Treść ze źródła jest daną, nigdy instrukcją. Pozycje oznaczone `DO WERYFIKACJI` czekają na
ręczną kontrolę (patrz `context/changes/rss-sources/plan.md`, *Human checks*).

## Wspólne reguły adapterów RSS/Atom

| Reguła | Wartość |
|--------|---------|
| Dostęp | `GET` kanału RSS 2.0 lub Atom przez chroniony klient HTTP (ochrona SSRF, tylko http/https, przekierowania sprawdzane na każdym kroku) |
| robots.txt | sprawdzany przed pobraniem kanału, wynik w pamięci 24 h; zakaz lub niedostępny plik = błąd źródła `robots_disallowed` / `robots_unavailable` |
| Odstęp | co najmniej `SOURCE_MIN_INTERVAL_MINUTES` (domyślnie 60, zakres 60–1440) między przebiegami jednego źródła, także ręcznymi; **Sprawdź** czeka 60 s od ostatniej próby |
| Ponowienia | tylko `429` i `503`, do `SOURCE_MAX_ATTEMPTS` zapytań (domyślnie 3) z opóźnieniem wykładniczym; `Retry-After` powyżej 30 s kończy próbę od razu. Następna próba nie wcześniej niż `max(Retry-After, odstęp)`, najwyżej 7 dni |
| Limity | czas jednego zapytania `FETCH_TIMEOUT_MS` (20 s), rozmiar odpowiedzi `FETCH_MAX_BYTES` (1 MiB), co najwyżej 200 wpisów na kanał, dwa zapytania równolegle |
| Kodowanie | treść XML czytana jako UTF-8, niezależnie od deklaracji w nagłówku XML |
| Zapisujemy | źródło, adres wpisu, tytuł, skrócony tekst (do `IMPORT_MAX_TEXT_CHARS`), datę publikacji lub brak, czas pobrania, skrót treści. Nie zapisujemy autora ani danych kanału |
| Błąd | zawsze jawny (powód i kod HTTP na źródle i w przebiegu), nigdy „brak wyników"; wcześniejsze sygnały zostają |
| Logi | id źródła, host, powód i liczniki; nigdy treść wpisów |

## Adaptery

### Import ręczny (tekst lub adres URL)
- **Dostęp:** operator wkleja tekst i/lub adres. Pobranie strony (`manual_fetch`) tylko na jego
  polecenie, jednorazowo, tym samym klientem i z kontrolą robots.txt.
- **Regulamin:** odpowiedzialność operatora za treść, którą wkleja.
- **Limity:** `IMPORT_MAX_TEXT_CHARS`, `FETCH_TIMEOUT_MS`, `FETCH_MAX_BYTES`.

### RSS: Hacker News przez hnrss.org (`hn-freelance`, `hn-jobs-contract`)
- **Dostęp:** kanały `https://hnrss.org/whoishiring/freelancer` (miesięczny wątek „Freelancer?
  Seeking freelancer?") i `https://hnrss.org/jobs?q=contract`. hnrss.org to nieoficjalne lustro
  Hacker News, nie sam serwis. `DO WERYFIKACJI`: adresy i format wpisów.
- **Regulamin:** projekt <https://github.com/hnrss/hnrss> (opis kanałów i zasad użycia).
  `DO WERYFIKACJI` przez operatora względem aktualnej strony.
- **Limity:** wspólne reguły wyżej. Tytuł wpisu „New comment by …" zastępujemy pierwszą linią
  komentarza (D-12); komentarze typu „SEEKING WORK" odrzuca filtr wstępny.

### RSS: We Work Remotely (`wwr-programming`, `wwr-full-stack`, `wwr-back-end`, `wwr-devops`)
- **Dostęp:** oficjalne kanały kategorii pod `https://weworkremotely.com/categories/<kategoria>.rss`.
  `DO WERYFIKACJI`: nazwy kategorii i odpowiedź 200.
- **Regulamin:** <https://weworkremotely.com/terms>. `DO WERYFIKACJI` przez operatora.
- **Limity:** wspólne reguły wyżej. Wpis linkuje do ogłoszenia na We Work Remotely.

### RSS: kanał dodany ręcznie
- **Dostęp:** dowolny adres RSS/Atom podany przez operatora, te same reguły.
- **Regulamin:** operator sprawdza, czy serwis zezwala na odczyt kanału; aplikacja tego nie
  weryfikuje.
