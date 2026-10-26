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

### RSS: Hacker News przez hnrss.org (`hn-freelance`; `hn-jobs-contract` wycofany)
- **Dostęp:** kanały `https://hnrss.org/whoishiring/freelance` (miesięczny wątek „Freelancer?
  Seeking freelancer?") i `https://hnrss.org/jobs?q=contract`. hnrss.org to nieoficjalne lustro
  Hacker News, nie sam serwis. `DO WERYFIKACJI`: adresy i format wpisów.
- **Regulamin:** projekt <https://github.com/hnrss/hnrss> (opis kanałów i zasad użycia).
  `DO WERYFIKACJI` przez operatora względem aktualnej strony.
- **Wycofany:** `hn-jobs-contract` (`https://hnrss.org/jobs?q=contract`) to ogłoszenia o pracę, nie
  zapytania o zlecenie; nie jest już oferowany (wycofany, shape D-15). Istniejące źródło działa
  dalej i ma w widoku znacznik „preset wycofany".
- **Limity:** wspólne reguły wyżej. Tytuł wpisu „New comment by …" zastępujemy pierwszą linią
  komentarza (D-12); komentarze typu „SEEKING WORK" odrzuca domyślny filtr źródła `hn-freelance`, a starsze źródła
  te komentarze nadal łapie filtr wstępny (FR-07).

### RSS: We Work Remotely (`wwr-programming`, `wwr-full-stack`, `wwr-back-end`, `wwr-devops`) — wycofany (shape D-15)
- **Dostęp:** oficjalne kanały kategorii pod `https://weworkremotely.com/categories/<kategoria>.rss`.
  `DO WERYFIKACJI`: nazwy kategorii i odpowiedź 200.
- **Regulamin:** <https://weworkremotely.com/terms>. `DO WERYFIKACJI` przez operatora.
- **Wycofany:** kanały to ogłoszenia o pracę, nie zapytania o zlecenie (wycofany, shape D-15);
  nie są już oferowane. Istniejące źródła działają dalej ze znacznikiem „preset wycofany".
- **Limity:** wspólne reguły wyżej. Wpis linkuje do ogłoszenia na We Work Remotely.

### RSS: Freelancer.com (`freelancer-nodejs`, `freelancer-react`, `freelancer-typescript`, `freelancer-arduino`, `freelancer-raspberry-pi`, `freelancer-iot`, `freelancer-3d-printing`, `freelancer-pcb-layout`, `freelancer-ai-automation`)
- **Dostęp:** kanał projektów `https://www.freelancer.com/rss.xml?keyword=<fraza>`, jeden na
  umiejętność. `DO WERYFIKACJI`: adres, parametr `keyword` (jeśli jest ignorowany, wszystkie
  źródła zwrócą ten sam kanał), format wpisów i robots.txt. Zakaz w robots.txt kończy się jawnym
  błędem `robots_disallowed`.
- **Regulamin:** <https://www.freelancer.com/about/terms>. `DO WERYFIKACJI` przez operatora, czy
  regulamin dopuszcza automatyczny odczyt kanału.
- **Limity:** wspólne reguły wyżej. Wpis linkuje do projektu na Freelancer.com; budżet zostaje
  tekstem źródła. Filtr źródła domyślnie wyłączony.

### RSS: Arduino Forum, „Jobs and Paid Consultancy" (`arduino-jobs`)
- **Dostęp:** kategoria Discourse jako kanał `https://forum.arduino.cc/c/community/jobs/42.rss`.
  `DO WERYFIKACJI`: adres kategorii, kanał `.rss` i robots.txt.
- **Regulamin:** <https://www.arduino.cc/en/terms-conditions>. `DO WERYFIKACJI` przez operatora.
- **Limity:** wspólne reguły wyżej. Domyślny filtr źródła odrzuca wpisy zawierające `[FOR HIRE]`
  lub `looking for work`.

### RSS: kanał dodany ręcznie
- **Dostęp:** dowolny adres RSS/Atom podany przez operatora, te same reguły.
- **Regulamin:** operator sprawdza, czy serwis zezwala na odczyt kanału; aplikacja tego nie
  weryfikuje.

## Filtr źródła

Każde źródło ma filtr: frazy do odrzucenia (`exclude`), frazy wymagane (`include`) i przełącznik.
- **Dopasowanie:** bez rozróżniania wielkości liter i krotności spacji (NFKC), podciąg w tytule
  i fragmencie tekstu; polskie znaki zostają. Najpierw `exclude` (pierwsza pasująca fraza w
  kolejności z konfiguracji), potem `include` (niepusta lista bez trafienia = „brak frazy").
  Włączony filtr z pustymi listami przepuszcza wszystko.
- **Kiedy:** przy przebiegu źródła, tylko dla nowego wpisu. Duplikat (także ręcznie zaimportowany)
  nie jest odrzucany ponownie, a zmiana filtru nie dotyka zapisanych sygnałów. Wpis wspólny dla
  kilku źródeł (np. ten sam projekt w kilku kanałach Freelancer.com) rozstrzyga źródło, które
  zobaczy go pierwsze: jego filtr może ukryć wpis, który inne źródło by przepuściło.
- **Skutek:** wpis jest zapisany jako `REJECTED` z powodem „filtr źródła: <fraza>" lub „filtr
  źródła: brak frazy", nie trafia do filtra wstępnego ani do LLM i nie wraca do kolejki. Liczba
  takich wpisów jest w wyniku przebiegu, historii przebiegów i w `pnpm discover`.
- **Wyłączenie** filtru zachowuje frazy; wpisy trafiają wtedy do analizy jak zwykle.
