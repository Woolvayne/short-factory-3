# ShortsFactory v3 — Anleitung

Drei neue Bausteine, alle ohne zusätzliches Backend:

| # | Feature | Wo eingestellt | Env-Variable (Vercel) |
| --- | --- | --- | --- |
| 1 | **Onepage-Passwortschutz** | volle Seite vor der App | `VITE_APP_PASSWORD_HASH` (oder `VITE_APP_PASSWORD`) |
| 2 | **Zernio-Versandweg** | Panel `06 · Versand · Zernio` | `ZERNIO_API_KEY` |
| 3 | **Reddit-Story-Intro** | `00 · Machine Settings → INTRO` | keine (liegt im localStorage) |

> Kurzversion: Hash erzeugen → beide Variablen in Vercel eintragen → **neu deployen** → fertig.
> Alles darunter steht hier im Detail.

---

## 1 · Onepage-Passwortschutz (ohne Backend)

### 1.1 So funktioniert es

Beim Build ersetzt Vite `import.meta.env.VITE_APP_PASSWORD_HASH` fest im JavaScript-Bundle.
Beim Öffnen der Seite rendert die App **ausschließlich** die Passwort-Seite
(`src/components/PasswordGate.tsx`) — die Fabrik dahinter wird gar nicht erst gemountet.
Das eingegebene Passwort wird im Browser mit **SHA-256** gehasht und gegen den Hash aus der
Environment-Variable geprüft (`src/lib/gate.ts`). Es gibt keinen Login-Endpoint, keine
Datenbank, keine Sessions auf einem Server.

Nach dem Entsperren merkt sich der Browser den Freischalt-Token:

* Standard: **sessionStorage** → gilt nur für diesen Tab, nach dem Schließen ist wieder zu.
* Häkchen **„Angemeldet bleiben"** → **localStorage** → bleibt bis zum manuellen Sperren.
* Oben rechts im Header gibt es dafür den Button **SPERREN**.

Ist **keine** der beiden Variablen gesetzt, ist das Gate deaktiviert und die App öffnet sich
direkt (praktisch für `npm run dev`).

### 1.2 Schritt für Schritt — Vercel Dashboard

**Schritt 1 — Passwort ausdenken** und Hash erzeugen:

```bash
npm install
npm run password:hash -- "meinSicheresPasswort"
```

Interaktiv (Eingabe bleibt unsichtbar) geht es auch:

```bash
npm run password:hash
```

Die Ausgabe sieht so aus:

```
┌─ SHORTSFACTORY · PASSWORT-SCHUTZ ────────────────────────────────
│ Passwort-Länge : 20 Zeichen
│ SHA-256        : 0ead2060b65992dca4769af601a1b3a35ef38cfad2c2c465bb160ea764157c5d
└──────────────────────────────────────────────────────────────────
```

**Schritt 2 — Variable in Vercel eintragen**

1. [vercel.com](https://vercel.com) → dein Projekt öffnen
2. **Settings** → **Environment Variables**
3. **Add New**
   * **Name:** `VITE_APP_PASSWORD_HASH`
   * **Value:** der SHA-256-Hash aus Schritt 1 (nur der Hash, ohne Passwort!)
   * **Environment:** `Production` ✔ `Preview` ✔ `Development` ✔ (nach Bedarf)
   * **Sensitive:** auslassen — die Variable muss beim Build lesbar sein
4. **Save**

**Schritt 3 — Neu deployen (wichtig!)**

Environment-Variablen mit `VITE_`-Prefix werden **beim Build** eingebrannt. Ein vorhandenes
Deployment kennt die neue Variable also noch nicht:

* Deployments → letztes Deployment → **⋯** → **Redeploy** (ohne „Use existing Build Cache"), oder
* einfach einen neuen Commit pushen, oder
* `vercel --prod`

**Schritt 4 — Testen**

Seite öffnen → Passwort-Seite erscheint → Passwort eingeben → **Fabrik entsperren**.
Falsches Passwort → Fehlermeldung, nach 5 Versuchen 15 Sekunden Pause.

### 1.3 Alternativ: Vercel CLI

```bash
npm i -g vercel
vercel link
printf '%s' "0ead2060b65992dca4769af601a1b3a35ef38cfad2c2c465bb160ea764157c5d" \
  | vercel env add VITE_APP_PASSWORD_HASH production
printf '%s' "0ead2060b65992dca4769af601a1b3a35ef38cfad2c2c465bb160ea764157c5d" \
  | vercel env add VITE_APP_PASSWORD_HASH preview
vercel --prod
```

### 1.4 Lokal testen

```bash
echo 'VITE_APP_PASSWORD_HASH=0ead2060b65992dca4769af601a1b3a35ef38cfad2c2c465bb160ea764157c5d' >> .env.local
npm run dev
```

`.env.local` steht in `.gitignore` und wandert nie ins Repo. Ohne diese Datei ist das Gate lokal
ausgeschaltet — du kommst also immer in die App.

### 1.5 Passwort ändern oder entfernen

* **Ändern:** neuen Hash erzeugen (`npm run password:hash -- "neu"`), Value in Vercel ersetzen,
  **Redeploy**. Alte gespeicherte Tokens werden automatisch ungültig, weil der gespeicherte Wert
  nicht mehr zum neuen Hash passt.
* **Entfernen:** Variable in Vercel löschen + Redeploy → die App ist wieder offen.

### 1.6 Ehrliche Sicherheitseinschätzung

Ein reines Frontend-Gate ist ein **Sichtschutz**, keine Server-Autorisierung:

* Der Hash liegt im ausgelieferten Bundle. Wer ihn hat, kann das Passwort offline raten
  (schwaches Passwort = schnell geknackt). Deshalb: **langes, zufälliges Passwort** wählen.
* Ein entschlossener Besucher kann die Gate-Prüfung im Browser umgehen und die Oberfläche laden.
* **Aber:** Der Zernio-Versand ist dadurch trotzdem geschützt. `api/zernio.js` verlangt den
  Header `x-sf-auth` und prüft ihn **serverseitig** gegen dieselbe Variable. Ohne gültiges
  Passwort liefert die Route `401` — dein `ZERNIO_API_KEY` kann also nicht von Fremden benutzt
  werden, und der Key selbst ist im Browser ohnehin nie sichtbar.
* Brauchst du echten Zugriffsschutz fürs ganze Projekt: **Vercel → Settings → Deployment
  Protection** (Password Protection / Vercel Authentication). Das ergänzt dieses Gate, ersetzt
  es aber nicht (Deployment Protection greift nicht auf Hobby-Plan-Domains für alle Besucher).

### 1.7 Troubleshooting

| Symptom | Ursache / Lösung |
| --- | --- |
| Gate erscheint nicht | Variable fehlt, heißt nicht exakt `VITE_APP_PASSWORD_HASH`, oder es wurde **nicht neu deployt** |
| „PRÜFUNG FEHLGESCHLAGEN / crypto.subtle fehlt" | Seite läuft über plain HTTP. `crypto.subtle` braucht HTTPS oder `localhost` |
| Passwort funktioniert nicht mehr | Passwort/Hash in Vercel geändert → alter Token ist ungültig, neu eingeben |
| Hash passt nie | Leerzeichen mitkopiert. `npm run password:hash` gibt den Hash ohne Leerzeichen aus; der Vergleich trimmt Eingaben zusätzlich |

---

## 2 · Zernio als Versandweg

Zernio ist die Social-Media-API (`https://zernio.com/api/v1`, Doku:
[docs.zernio.com](https://docs.zernio.com)), die hinter dem Versand steckt: ein Upload, ein Post,
16 Plattformen. **Es gibt keinen Kalender in dieser App** — nur drei Versand-Arten.

### 2.1 Voraussetzungen

1. Zernio-Account: [zernio.com](https://zernio.com/signup) (die ersten 2 verbundenen Accounts sind kostenlos)
2. API-Key anlegen: [zernio.com/dashboard/api-keys](https://zernio.com/dashboard/api-keys) — Format `sk_` + 64 Hex-Zeichen
3. Mindestens einen Social-Account verbinden (TikTok, Instagram, YouTube, …)

### 2.2 `ZERNIO_API_KEY` in Vercel setzen

**Settings → Environment Variables → Add New**

* **Name:** `ZERNIO_API_KEY`
* **Value:** `sk_...`
* **Environment:** Production ✔ Preview ✔
* **Wichtig:** *kein* `VITE_`-Prefix! Nur Variablen mit `VITE_` landen im Browser-Bundle —
  dieser Key gehört ausschließlich in die Serverless-Function `api/zernio.js`.
* Danach **Redeploy** (Serverless-Functions lesen Env zur Laufzeit, der Build-Cache kann trotzdem
  kleben bleiben).

Lokal: `echo 'ZERNIO_API_KEY=sk_...' >> .env.local` und `vercel dev` (der reine `vite`-Devserver
führt keine Serverless-Functions aus).

### 2.3 Was beim Senden passiert

```
1. POST /api/zernio {action:"presign"}   → Zernio POST /v1/media/presign
2. PUT  <uploadUrl>  (Video direkt aus dem Browser, bis 5 GB)
3. POST /api/zernio {action:"publish"}   → Zernio POST /v1/posts
                                            mediaItems: [{ type:"video", url: publicUrl }]
                                            publishNow: true  ODER  scheduledFor + timezone
```

* Der API-Key bleibt serverseitig, der Browser sieht ihn nie.
* Ziel-Accounts werden **automatisch** über `GET /v1/accounts` ermittelt (alle verbundenen,
  aktiven Accounts). Nichts zum Anklicken, nichts zum Konfigurieren.
* Ist TikTok dabei, sendet die Route die von TikTok verlangten `tiktokSettings`
  (`PUBLIC_TO_EVERYONE`, Kommentare/Duet/Stitch erlaubt, Content-Preview bestätigt) automatisch mit.
* YouTube-Titel werden auf 100 Zeichen gekürzt (API-Limit).

### 2.4 Die drei Versand-Arten (Panel `06 · Versand · Zernio`)

| Modus | Verhalten |
| --- | --- |
| **SOFORT** | `publishNow: true` — jedes Video geht direkt nach dem Upload raus |
| **06 & 20 UHR** | ein Video um 06:00, das nächste um 20:00 (Europe/Berlin), dann der nächste Tag … Beide Uhrzeiten sind editierbar. Der Sendeplan darunter zeigt alle 10 Zeiten als Liste — kein Kalender |
| **FLEXIBEL** | Startzeit (`datetime-local`) + Abstand (15 Min bis 1 Tag). Liegt die Startzeit in der Vergangenheit, wird automatisch auf den nächsten freien Zeitpunkt vorgespult |

Zusätzlich: **„Als Entwurf speichern"** → `isDraft: true`. Landet als Draft in Zernio, wird nicht
veröffentlicht. Perfekt, um den kompletten Weg einmal ohne Risiko durchzutesten.

Geplante Zeiten gehen als `scheduledFor` (Wandzeit) **plus** `timezone: "Europe/Berlin"` raus —
so erwartet es die Zernio-API, und die Sommer-/Winterzeit stimmt automatisch.

### 2.5 Der 3-Sekunden-Takt

Zwischen **jeden beiden** Videos wartet die Fabrik exakt **3 Sekunden**
(`SHIP_GAP_MS = 3000` in `src/lib/zernio.ts`). Das gilt:

* beim Batch-Versand (alle 10 mit einem Klick),
* wenn du mehrere Einzelversande kurz hintereinander klickst — alles landet in derselben
  Warteschlange und wird mit 3 s Abstand abgearbeitet,
* unabhängig vom Modus (auch bei „SOFORT").

Im Panel und in der Status-Pille unten läuft der Countdown sichtbar mit: `PAUSE 2.4 s`.
**STOP** bricht die Warteschlange ab (das gerade laufende Video wird noch fertig gesendet).

### 2.6 Einzelversand vs. alle 10

* **Einzelnes Video:** in der Output Bay (`05`) hat jede fertige Karte einen Button **→ ZERNIO**.
  Er erscheint erst, sobald das Video gerendert ist. Danach zeigt er den Zernio-Status
  (`GEPLANT`, `VERÖFFENTLICHT`, `ENTWURF`, `FEHLER`).
* **Alle 10:** im Panel `06` der Button **`10 Videos → Zernio`** (bzw. die Anzahl der noch nicht
  gesendeten). Er nimmt alle gerenderten Videos in die Warteschlange.
* Unter „Einzelversand" findest du zusätzlich alle fertigen Units als Chips — praktisch, wenn du
  nur 3 von 10 rausschicken willst.

### 2.7 Titel, Caption, Hashtags

Im Panel `06` rechts:

* **POST-TITEL** — leer lassen = der Titel aus dem Idea-Feld des Videos (empfohlen, weil jede
  Story ihren eigenen Titel bekommt). Max. 100 Zeichen (YouTube-Limit).
* **HASHTAGS** — z. B. `#shorts #redditstories #storytime #viral #fyp`
* **CAPTION-VORLAGE** — Platzhalter: `{title}` `{idea}` `{excerpt}` (erste ~240 Zeichen der Story)
  `{story}` (vollständiger Text) `{hashtags}` `{index}`

Standard:

```
{title}

{excerpt}

{hashtags}
```

### 2.8 Dateigrößen & der Upload-Fallback

* **Normalfall:** der Browser lädt das Video **direkt** auf die Presigned-URL (bis 5 GB). Kein
  Vercel-Body-Limit, Upload-Fortschritt inklusive.
* **Fallback:** blockt der Storage-Host den Browser-Upload (CORS), geht dieselbe Datei automatisch
  über die eigene Serverless-Route (`POST /api/zernio/upload`). Vercel begrenzt Request-Bodies auf
  **4,5 MB** — für größere Videos schlägt auch der Fallback fehl. Dann: in `00 → VIDEO` die
  Auflösung (540×960) oder Bitrate (LIGHT) senken, oder das Video per **ZIP** holen und manuell
  hochladen.
* `WEBM`-Renders (Chrome/Firefox) werden als `video/webm` verschickt; Safari rendert MP4/H.264.
  TikTok/Instagram/YouTube bevorzugen MP4 — für den Versand ist Safari als Render-Browser die
  sicherste Wahl.

### 2.9 Troubleshooting

| Meldung | Lösung |
| --- | --- |
| `ZERNIO_API_KEY fehlt` | Variable in Vercel gesetzt? Neu deployt? |
| `Nicht freigeschaltet …` (401) | Passwort-Gate aktiv, aber ohne gültige Sitzung aufgerufen → Seite normal über das Gate öffnen |
| `Kein verbundener Social-Account` | bei Zernio mindestens einen Account verbinden, dann Button **API** im Panel |
| `Upload HTTP 403` | Presigned-URL abgelaufen (1 h) → einfach erneut senden |
| `Zernio HTTP 429` | Rate Limit (Free: 60 req/min) — der 3-Sekunden-Takt hält dich normalerweise darunter, sonst kurz warten |
| `Zernio HTTP 403 (plan limit)` | mehr als 2 Accounts verbunden → Zernio-Abrechnung prüfen |

---

## 3 · Reddit-Story-Intro

Das klassische Titel-Card-Intro: eine Reddit-Post-Karte (Avatar, `r/Subreddit`, Alter, **Titel**,
Upvotes + Kommentare) fliegt über die ersten Sekunden des Videos ein, bleibt kurz stehen und
fliegt wieder raus. Sie wird **direkt in den Canvas-Render gezeichnet** — ist also fest im Video
eingebrannt, kein Overlay und kein Schnittprogramm nötig.

### 3.1 Einstellungen (`00 · Machine Settings → INTRO`)

| Einstellung | Standard | Bedeutung |
| --- | --- | --- |
| **REDDIT-STORY INTRO** | an | Master-Schalter |
| **Titel-Quelle** | `IDEA-FELD` | `IDEA-FELD` = jedes Video zeigt seinen eigenen Titel aus Schritt 01 · `FESTER TITEL` = alle 10 zeigen denselben |
| **Eigener Titel** | leer | der einstellbare Titel (bis 5 Zeilen, Rest endet mit `…`) |
| **Subreddit** | `r/AmItheAsshole` | steht über dem Titel |
| **Alter-Label** | `12 Std.` | kleine Zeitangabe daneben |
| **Autor** | `u/Throwaway_42` | zweite Zeile im Kartenkopf (leer = wird weggelassen) |
| **Upvotes** | `15400` | zählt beim Einfliegen sichtbar hoch, Kommentare werden daraus abgeleitet |
| **Dauer im Video** | **3.0 s** | wie lange die Karte sichtbar ist — die „ersten 3 Sekunden" |
| **Flug-Bewegung** | `FLY UP` | `FLY UP` (von unten) · `FLY IN` (von links) · `DROP` (von oben) |
| **Karten-Look** | `DARK` | Reddit-Nachtmodus oder Tagmodus |
| **Position** | 36 % von oben | Kartenmitte; Captions bleiben bei ~60 % |
| **Titelgröße** | 5.8 % der Breite | bei 1080 px Breite ≈ 63 px |
| **Hintergrund abdunkeln** | 34 % | legt sich nur während des Intros über das Video |
| **Upvotes + Kommentare** | an | Statistik-Zeile unter dem Titel |

### 3.2 Live-Vorschau

Rechts im INTRO-Tab läuft eine echte Vorschau: **INTRO ABSPIELEN** zeigt die Karte in einer
Schleife über einem Platzhalter-Hintergrund (inklusive deiner Caption-Einstellungen), der Regler
darunter scrubbt Frame für Frame durch die ersten Sekunden. Gezeichnet wird exakt dieselbe
Funktion wie im Render — die Vorschau ist kein Mockup.

### 3.3 Tipps

* Titel kurz halten: 6–10 Wörter wirken am besten, lange Titel werden auf 5 Zeilen begrenzt.
* Position ~34–40 % lässt Platz für die Captions bei 60 % (TikTok/Reels-UI sitzt unten).
* Dauer 3 s ist der Standard-Look; 2.5 s wirkt schneller, 4 s lässt Zeit zum Lesen langer Titel.
* Änderung der Intro-Einstellungen betrifft **nur neue Renders** — bereits gerenderte Units
  bleiben unverändert (einfach **RE-RENDER** drücken).

---

## 4 · Alle Environment-Variablen auf einen Blick

| Variable | Prefix | Wo | Pflicht | Zweck |
| --- | --- | --- | --- | --- |
| `VITE_APP_PASSWORD_HASH` | `VITE_` → Browser | Build | nein¹ | SHA-256 des Gate-Passworts |
| `VITE_APP_PASSWORD` | `VITE_` → Browser | Build | nein¹ | Klartext-Fallback (nicht empfohlen) |
| `ZERNIO_API_KEY` | serverseitig | Runtime | für Versand | Zernio-API-Key `sk_…` |
| `ZERNIO_BASE_URL` | serverseitig | Runtime | nein | eigene API-Basis, Standard `https://zernio.com/api/v1` |

¹ Ohne beide Passwort-Variablen ist das Gate aus — die App ist dann öffentlich erreichbar.

Qwen-/Mistral-Keys gehören **nicht** nach Vercel, sondern in die App (`00 → AI`) und liegen nur im
localStorage deines Browsers.

---

## 5 · Deployment-Checkliste

```bash
npm install
npm run password:hash -- "meinPasswort"      # Hash für das Gate
npm run typecheck                            # optional: TypeScript prüfen
npm run build                                # baut dist/ (Single-File)
```

Vercel:

- [ ] `VITE_APP_PASSWORD_HASH` gesetzt (Production + Preview)
- [ ] `ZERNIO_API_KEY` gesetzt (**ohne** `VITE_`)
- [ ] neu deployt (Redeploy ohne Build-Cache)
- [ ] Seite öffnen → Passwort-Seite erscheint → Entsperrung funktioniert
- [ ] Panel `06` zeigt grüne LED „ZERNIO_API_KEY VERBUNDEN" + deine Accounts
- [ ] ein Video rendern → **→ ZERNIO** → Status wird `GESENDET/GEPLANT`
- [ ] optional: „Als Entwurf speichern" für den ersten Testlauf
