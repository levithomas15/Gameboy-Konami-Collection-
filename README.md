# Cartridge Collection

Ein Handheld im Browser. Du wählst eine Cartridge, sie fliegt mit einer
Dreh- und Click-Animation in den Schacht, der Strom geht an — und dann läuft
das Spiel wirklich, mit Bild, Ton, Spielständen und allem.

Reines HTML, CSS und JavaScript. Kein Build-Schritt, keine Abhängigkeiten,
kein npm. Die Seite kann so wie sie ist auf GitHub Pages liegen.

---

## Wichtig: Spiele sind nicht enthalten

**Dieses Repository enthält keine Spiele und wird nie welche enthalten.**
Es ist ein Emulator, kein Spielearchiv.

Du wählst deine eigenen ROM-Dateien in der App aus — von Modulen, die dir
gehören. Die Dateien bleiben dabei vollständig in deinem Browser:

* Sie werden in IndexedDB gespeichert, lokal auf deinem Gerät.
* Sie werden **nicht** hochgeladen. Nach dem Laden der Seite gibt es
  überhaupt keine Netzwerkzugriffe mehr.
* Die `.gitignore` blockiert `*.gb`, `*.gbc`, `*.sav` und Archivformate,
  damit auch ein versehentliches `git add .` keine Datei ins Repo zieht.

Die Sammlungs-Cartridges bringen ihr eigenes Vier-Spiele-Menü mit. Die App
baut deshalb bewusst kein eigenes Menü — du siehst direkt die Originalauswahl.

---

## Lokal starten

Ein statischer Server genügt. Über `file://` funktioniert es **nicht**:
ES-Module und WebAssembly werden dort vom Browser blockiert.

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

oder

```bash
npx serve .
```

## Auf GitHub Pages veröffentlichen

Settings → Pages → *Deploy from a branch* → Branch `main`, Ordner `/ (root)`.
Sonst nichts. Die Datei `.nojekyll` liegt bereits im Repo und sorgt dafür,
dass Pages die Dateien unverändert ausliefert.

---

## Steuerung

| Taste | Funktion |
| --- | --- |
| Pfeiltasten | Steuerkreuz |
| `A` / `S` | B / A |
| `Enter` | Start |
| Umschalt rechts | Select |
| `F2` / `F4` | Spielstand sichern / laden |
| `P` | Pause |
| `[` / `]` | Farbpalette (nur Graustufen-Spiele) |

`A`/`S` statt der sonst üblichen `Z`/`X`, weil `Z` und `Y` auf einer
deutschen Tastatur vertauscht sind und die Beschriftung dann nicht mehr passt.

Ein angeschlossenes Gamepad wird automatisch erkannt. Auf dem Handy sind die
Tasten am Gehäuse direkt bedienbar — das Steuerkreuz erkennt Diagonalen und
man kann mit dem Daumen zwischen Richtungen rollen, ohne abzusetzen.

---

## Wie es aufgebaut ist

```
index.html            Aufbau der Seite
css/
  tokens.css          alle Farben, Maße und Animationszeiten
  shell.css           das durchscheinende Gehäuse
  controls.css        Steuerkreuz, Tasten, Pillen
  cartridge.css       Cartridges als echte 3D-Körper
  animation.css       Ruck, Schweben, reduzierte Bewegung
  ui.css              Seitenleiste, Werkzeugleiste, Meldungen
js/
  main.js             Verdrahtung, Zustände, Lebenszyklus
  core-loader.js      lädt den WebAssembly-Kern
  emulator.js         Hülle um binjgb
  renderer.js         WebGL mit Canvas2D als Rückfallebene
  audio.js            Emulator-Ton und synthetisierte Klick-Geräusche
  input.js            Zeiger, Tastatur, Gamepad
  rom.js              Cartridge-Header lesen und prüfen
  cartridges.js       Regal-Katalog
  storage.js          IndexedDB
  insert.js           die Einsteck- und Auswurf-Choreografie
vendor/binjgb/        Emulator-Kern (MIT)
```

Ein paar Entscheidungen, die beim Weiterbauen nützlich sind:

* **`emulator.js` kennt kein DOM.** Renderer und Tonausgabe werden
  hineingereicht, der Kern liefe also auch ohne Bildschirm.
* **Die Animationszeiten stehen in `tokens.css`**, und `insert.js` liest sie
  per `getComputedStyle` aus. CSS und JavaScript können deshalb nicht
  auseinanderlaufen.
* **Eine andere Gehäusefarbe ist eine Zeile.** `--shell-h` in `tokens.css`
  umstellen, oder `data-shell="berry"` am `<html>`-Element setzen.
* **Klänge sind synthetisiert**, nicht abgespielt. Der Klick beim Einrasten
  ist ein Rausch-Burst plus ein tiefer Ton aus dem Web-Audio-Baukasten —
  deswegen kommt die ganze Seite ohne eine einzige Audiodatei aus.

### Warum sich die Cartridge dreht

Auf echter Hardware steckt man die Cartridge mit dem Label **nach hinten**
ein, im Regal zeigt es aber nach vorne. Sie *muss* sich also unterwegs um
180 Grad drehen. Die Animation erzählt damit die Wahrheit über den
Gegenstand — und genau deshalb fühlt sie sich richtig an und nicht bloß
dekorativ.

---

## Lizenz

Der Code steht unter der MIT-Lizenz (siehe `LICENSE`).

Der Emulator-Kern ist [binjgb](https://github.com/binji/binjgb) von
Ben Smith, ebenfalls MIT. Er liegt unverändert unter `vendor/binjgb/`,
zusammen mit seiner Lizenz und der Angabe des verwendeten Commits.

Gehäuse, Schriftzug und Cartridge-Labels sind eigene Gestaltungen. Es werden
keine fremden Logos, Verpackungsgrafiken oder Markenzeichen nachgebildet.
