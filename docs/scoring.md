# Scoring (rubric version 1)

Wynik 0–100 jest liczony **regułami**, nie przez model (PRD §7). Model dostarcza tylko
ustrukturyzowaną analizę (schemat v1); `apps/api/src/modules/scoring/` zamienia ją na punkty.
Te same dane wejściowe i ten sam profil dają zawsze ten sam wynik. Nie ma żadnego
„prawdopodobieństwa zamknięcia”.

Każdy wynik ma rozbicie na pięć składników (suma = wynik, każdy ≤ maksimum) i polskie
uzasadnienie każdego składnika. Pewność (`confidence`) jest zapisywana osobno i nie wchodzi do
sumy.

## Składniki

| Składnik | Maks. | Reguła |
|----------|-------|--------|
| Popyt (`demand`) | 30 | Poziom dowodu, potwierdzony / niepotwierdzony nabywca: `DIRECT_REQUEST` 30 / 22, `EXPLICIT_PROBLEM` 18 / 12, `INDIRECT_SIGNAL` 10 / 6, `SPECULATIVE` 6 / 3 |
| Dopasowanie umiejętności (`skillFit`) | 25 | Liczba różnych umiejętności i preferowanych technologii z profilu, które model wskazał w `relevantSkills` (bez rozróżniania wielkości liter): 0 → 0, 1 → 10, 2 → 16, 3 → 21, ≥ 4 → 25. Wymieniona wykluczona technologia → 0 |
| Szybkość (`speed`) | 20 | Baza kategorii: `DIRECT_GIG` 12, `B2B_SUBCONTRACT` 10, `HARDWARE_IOT` 6, `UNMET_NEED` 4, `PRODUCT_HYPOTHESIS` 2; plus przedział `estimatedHours.max`: ≤ 40 h → 8, ≤ 120 h → 5, ≤ 400 h → 2, powyżej → 0, nieznane → 3 |
| Opłacalność (`profitability`) | 15 | Tylko budżet podany w źródle. Górna granica poniżej minimalnej wartości zlecenia z profilu (ta sama waluta) → 0. Inaczej stawka wynikająca z budżetu i szacowanych godzin w relacji do pierwszej stawki godzinowej z profilu (ta sama waluta): ≥ 100 % → 15, ≥ 75 % → 10, ≥ 50 % → 5, poniżej → 0. Brak budżetu, godzin lub stawki → 5 („brak danych — wartość neutralna”) |
| Powtarzalność (`repeatability`) | 10 | Baza kategorii: `PRODUCT_HYPOTHESIS` 8, `UNMET_NEED` 7, `B2B_SUBCONTRACT` 6, `HARDWARE_IOT` 5, `DIRECT_GIG` 4; +2 dla modelu `SUBSCRIPTION` lub `PRODUCT_SALE`; maksimum 10 |

Cena zaproponowana przez model (`proposedPrice`) to **szacunek (hipoteza)**, zbudowany ze stawek
z profilu. Nie wpływa na opłacalność (ocenianie jej względem tych samych stawek byłoby
kołowe) i w każdym widoku jest oznaczona „szacunek (hipoteza)”. Budżet ze źródła jest pokazywany
osobno, jako cytat „ze źródła”.

## Pewność

Reguły, w kolejności:

1. `LOW` — poziom dowodu `SPECULATIVE` albo co najmniej 5 pozycji w `unknowns`;
2. `HIGH` — poziom `DIRECT_REQUEST` lub `EXPLICIT_PROBLEM`, nabywca potwierdzony i najwyżej
   2 pozycje w `unknowns`;
3. `MEDIUM` — pozostałe przypadki.

## Wersje

Rozbicie niesie `version: 1`. Zmiana tabel powyżej podnosi wersję; zapisane wyniki zachowują
wersję, według której powstały.
