---
sessionId: session-261004-185650-114n
---

# Anforderungen

### Ziel
Die **moderne Timerliste** zeigt Beginn und Ende abhängig davon, ob beide auf denselben Kalendertag fallen. Dies gilt für die kompakte Liste und die Kartenansicht.

- **Gleicher Tag:** `Mo, 05.10.2026 20:15-22:00`
- **Unterschiedliche Tage:** `Mo, 05.10.2026 23:15 - Di, 06.10.2026 01:00`
- Wochentage verwenden vorhandene Übersetzungen; das bestehende lokalisierte Datumsformat bleibt erhalten.
- Maßgeblich ist der Kalendertag in der lokalen Zeitzone des Receivers.
- Status, Dauer, Wiederholungsangaben und Timer-Aktionen bleiben unverändert. Die bestehende Unterdrückung der Endzeit bei Umschalttimern in der Kartenansicht bleibt bestehen.

### Abgrenzung
Keine Änderungen am klassischen Design, an EPG-Zeitschrift oder EPG-Zeitstrahl, Timer-Bearbeitungsfeldern, APIs oder gespeicherten Timerdaten. Dieser Auftrag erstellt ausschließlich einen Plan; bisher wurden keine Dateien geändert.

# Technisches Design

### Bestehende Umsetzung
- `plugin/controllers/views/responsive/ajax/timers.tmpl`: kompakte Ausgabe bei `mintimerlist` (Zeilen 95–97) und Kartenansicht (Zeilen 186–191).
- `plugin/controllers/models/timers.py`, `getTimerObj()`: liefert `begin`, `end`, `realbegin` und `realend`; die letzten beiden enthalten jeweils Datum und Uhrzeit. Diese gemeinsam verwendeten Felder bleiben unverändert.
- `plugin/controllers/i18n.py`: vorhandene Schlüssel `day_0` bis `day_6` liefern übersetzte Wochentagskürzel.

### Umsetzung
Die Formatierung bleibt vollständig in der modernen Cheetah-Vorlage; keine neue Komponente oder JavaScript-Anpassung.

1. Pro Timer lokale Beginn- und Endzeit mit `localtime()` bestimmen. Zum Tagesvergleich Jahr, Monat und Tag vergleichen, nicht Zeitdifferenz oder formatierte Anzeigetexte.
2. Den Beginn als übersetzten Wochentag, Komma und vorhandenes `realbegin` aufbereiten.
3. Bei gleichem Tag nur die Enduhrzeit mit `strftime('%H:%M', endLocal)` ausgeben; andernfalls Endwochentag, Komma und `realend` verwenden.
4. Diese einmal pro Timer berechneten Werte in beiden Darstellungszweigen nutzen. Den bisherigen separaten Beginn-Wochentag der kompakten Liste ersetzen, damit er nicht doppelt erscheint.
5. Vorhandene `<time>`-Elemente und die bedingte Ausgabe von Endzeit und Dauer beibehalten. Tagesübergreifende Zeiträume dürfen zwischen den Endpunkten umbrechen.

### Dateien
- Ändern: `plugin/controllers/views/responsive/ajax/timers.tmpl`.
- Ergänzen: `testsuite/test_modern_timer_date_range.py` mit Rendertests nach dem Muster von `testsuite/test_tag_manager_template.py`.
- Unverändert: gemeinsames Timer-Modell, klassische Vorlagen, Übersetzungsdateien und Frontend-Bundles.

# Validierung

### Automatisierte Prüfung
Cheetah-Rendertests mit kontrollierter lokaler Zeit und Übersetzungen für beide Werte von `mintimerlist` ergänzen. Die sichtbaren Zeittexte samt Trennzeichen prüfen.

- Gleicher Tag: ein Datum und ein Wochentag, zwei Uhrzeiten.
- Tageswechsel einschließlich Ende exakt um Mitternacht: beide Daten und Wochentage.
- Monats- und Jahreswechsel sowie mehrtägiger Timer mit gleichem Wochentag: vollständige Endangabe.
- Zeitumstellung: Entscheidung weiterhin anhand lokaler Kalenderdaten.
- Umschalttimer: bisherige Endzeit-Unterdrückung in der Kartenansicht erhalten.
- Dauer, Status, Wiederholungen und Aktions-Metadaten unverändert.

Zusätzlich die bestehenden Rendertests in `testsuite/test_tag_manager_template.py` ausführen, um Vorlagenkompilierung und Tag-Filter-Metadaten abzusichern.

# Delivery Steps

### ✓ Step 1: Datumslogik und kompakte Timeranzeige umsetzen
Die kompakte moderne Timerliste zeigt den Zeitraum im gewünschten tagesabhängigen Format.

- In `plugin/controllers/views/responsive/ajax/timers.tmpl` lokale Kalenderdaten und übersetzte Wochentage einmal pro Timer bestimmen.
- Beginn- und Endanzeige sowie passende Trennzeichen vorbereiten, ohne `realbegin` oder `realend` im Modell zu verändern.
- Den kompakten Darstellungszweig auf diese Werte umstellen und den bisherigen separaten Wochentag ersetzen.
- In `testsuite/test_modern_timer_date_range.py` Rendertests für gleiche und unterschiedliche Tage in der kompakten Ansicht ergänzen.

### ✓ Step 2: Timer-Karten auf das neue Zeitraumformat umstellen
Die moderne Kartenansicht verwendet dieselbe Datumslogik; beide Ansichten sind gegen Kalendergrenzen abgesichert.

- In `plugin/controllers/views/responsive/ajax/timers.tmpl` die Kartenanzeige an die vorbereiteten Zeitraumwerte anbinden.
- Bestehende Behandlung von Umschalttimern, Daueranzeige und Umbruch zwischen Endpunkten erhalten.
- Rendertests auf beide Ansichten sowie Mitternacht, Monats-/Jahreswechsel, mehrtägige Timer und Zeitumstellung erweitern.
- Die neuen Tests und `testsuite/test_tag_manager_template.py` ausführen; unveränderte Status-, Wiederholungs- und Aktionsdaten prüfen.