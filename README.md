# PreChecker

Lokalna aplikacja desktopowa wykrywająca możliwe literówki w tekście widocznym na ekranie. Obsługuje jednocześnie język polski i angielski.

## Jak działa prototyp

1. Użytkownik ustawia kursor na monitorze z projektem.
2. Uruchamia skan przyciskiem albo skrótem `Ctrl+Shift+K` (`Cmd+Shift+K` na macOS).
3. Electron przechwytuje wskazany monitor, zanim pokaże jakiekolwiek własne okno.
4. Użytkownik przeciągnięciem zaznacza prostokątny fragment; `Esc` albo prawy przycisk myszy anuluje operację.
5. Tesseract rozpoznaje wyłącznie zaznaczony fragment lokalnie z modelami `pol+eng`.
6. Hunspell porównuje słowa z polskim i angielskim słownikiem.
7. Aplikacja pokazuje podejrzane słowa, sugestie i pozwala dodać nazwy własne do prywatnego słownika.

Zrzuty ekranu są przetwarzane w pamięci i nie są zapisywane ani wysyłane do sieci.

## Uruchomienie

```powershell
npm install
npm run dev
```

Pierwsze skanowanie trwa dłużej, ponieważ aplikacja inicjalizuje lokalne słowniki i silnik OCR. Kolejne skany są znacznie szybsze.

## Testy

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e
```

`test:e2e` uruchamia prawdziwą aplikację Electron, wyświetla pełnoekranowe plansze testowe, przeciąga obszar na nakładce i sprawdza cały przepływ aż do wyników w interfejsie. Osobno sprawdza anulowanie klawiszem `Esc`.

Kontrolne grafiki znajdują się w [`tests/fixtures`](./tests/fixtures):

- `poster-pl.svg`: `WYPRZEDARZ`, `Najleprze`, `wiencej`,
- `poster-en.svg`: `Recieve`, `avalable`, `Adress`,
- `poster-mixed.svg`: `ŚWIERZO`, `COLECTION`, `desing`.

W aktualnych testach Windows wszystkie 9 błędów zostało rozpoznanych. Pewność OCR wyniosła 77–94% (zależnie od dodatkowych elementów systemowych widocznych przy krawędzi ekranu), a kolejne skany trwały około 1,4–2,8 sekundy.

## macOS

Kod korzysta z wieloplatformowych API Electrona, Tesseracta i Hunspella. Na pierwszym uruchomieniu macOS powinien poprosić o uprawnienie **System Settings → Privacy & Security → Screen Recording**. Po jego nadaniu aplikację trzeba zwykle uruchomić ponownie.

Bez fizycznego Maca nie są jeszcze potwierdzone:

- systemowy dialog i ponowne uruchomienie po przyznaniu uprawnienia,
- skrót `Cmd+Shift+K` w innych aplikacjach,
- zachowanie na ekranach Retina i przy wielu monitorach,
- dystrybucja oraz podpis/notaryzacja paczki dla Apple Silicon i Intela.

## Ograniczenia MVP

- Sprawdzanie bazuje na słownikach, więc wykrywa pisownię, ale nie błędy gramatyczne zależne od kontekstu, np. `nową kolekcje` zamiast `nową kolekcję`.
- Nazwy marek i nazwiska mogą być zgłaszane jako podejrzane; można je dodać do lokalnego słownika.
- Małe, obrócone lub mocno stylizowane napisy mogą obniżyć skuteczność OCR.
