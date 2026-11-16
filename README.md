# Familien-Stammbaum

Ein kleiner, privater Webdienst für den Stammbaum einer Familie – selbst gehostet per Docker.
Alle Familienmitglieder öffnen ihn im Browser (Handy, Tablet, PC) mit einem gemeinsamen Familien-Passwort.
Änderungen reicht die Familie als **Vorschlag** ein, die Verwaltung gibt sie frei.

*A small self-hosted family tree web app (German UI). Docker image, no external dependencies, no tracking.*

## Funktionen

- **Stammbaum** mit Generationen-Spalten, Zoom, Suche, Auf-/Zuklappen, Druckansicht
- **Personenseiten** mit Eltern, Partnern, Geschwistern, Kindern, Foto und eigenen Feldern (Beruf, E-Mail …)
- **„Wer bist du?“** – jede Person zeigt dann „Für dich: Cousine 2. Grades“, „Großonkel“, „Schwägerin“ …
- **Verwandtschaftsrechner** mit gezeichnetem Weg über die gemeinsamen Vorfahren
- **Herkunftsfamilie angeheirateter Partner**: Eltern, Geschwister und Kinder aus anderen Beziehungen –
  mit Begriffen wie Schwiegermutter, Gegenschwiegervater, Stieftochter, Halbbruder
- **Quellen & Dokumente**: Traueranzeigen, Stammbuchauszüge, Urkunden, alte Fotos (Handykamera oder PDF),
  mehreren Personen zuordenbar
- **Zeitleiste** je Person: Partner & Kinder, Eltern & Geschwister, Vorfahren
- **Interview**: fragt fehlende Daten und Beziehungen nacheinander ab, nahe Familie zuerst
- **Geburtstage** der nächsten 12 Monate, Gedenktage und **Kalender-Abo** (iPhone, Android, Outlook)
- **Verwaltung**: Vorschläge mit Vorher/Nachher-Ansicht, Änderungsprotokoll, Datenprüfung,
  Export als JSON/CSV (Excel), Import
- Tägliche Sicherung, keine externen Abhängigkeiten, keine Google-Fonts (DSGVO-freundlich),
  nicht von Suchmaschinen auffindbar, Hell- und Dunkelmodus

Beim ersten Start wird eine **frei erfundene Beispielfamilie** („Familie Muster“) geladen, damit man sofort
etwas sieht. Mit `BEISPIELDATEN=false` startet der Stammbaum leer.

---

## Installation

### Mit fertigem Image (empfohlen)

Bei jedem Push baut GitHub automatisch ein Image: `ghcr.io/maximiliansr/stammbaum:latest`
(für amd64 und arm64, also auch für Raspberry Pi und viele NAS).

```bash
mkdir -p /opt/stammbaum/data && cd /opt/stammbaum
chown -R 1000:1000 data
docker run -d --name stammbaum --restart unless-stopped \
  -p 3000:3000 \
  -e FAMILY_PASSWORD='familie-passwort' \
  -e ADMIN_PASSWORD='langes-admin-passwort' \
  -e COOKIE_SECURE=false \
  -v /opt/stammbaum/data:/data \
  ghcr.io/maximiliansr/stammbaum:latest
```

Dann <http://SERVER-IP:3000> öffnen.

> Ist das Repository privat, ist auch das Image privat. Entweder unter GitHub → Packages → Package settings
> die Sichtbarkeit auf „Public“ stellen (das Image enthält keine Familiendaten) oder vorher
> `docker login ghcr.io` mit einem Token (Recht `read:packages`) ausführen.

### Portainer (z. B. Docker-LXC auf Proxmox)

1. Datenordner anlegen: `mkdir -p /opt/stammbaum/data && chown -R 1000:1000 /opt/stammbaum/data`
2. **Stacks → Add stack → Web editor**:

   ```yaml
   services:
     stammbaum:
       image: ghcr.io/maximiliansr/stammbaum:latest
       container_name: stammbaum
       restart: unless-stopped
       ports:
         - "3000:3000"
       environment:
         FAMILY_PASSWORD: ${FAMILY_PASSWORD}
         ADMIN_PASSWORD: ${ADMIN_PASSWORD}
         TRUST_PROXY: "true"
         COOKIE_SECURE: "false"   # auf "true", sobald HTTPS über einen Reverse-Proxy läuft
       volumes:
         - /opt/stammbaum/data:/data
   ```

3. Unter *Environment variables* `FAMILY_PASSWORD` und `ADMIN_PASSWORD` setzen → **Deploy**.
4. **Update** auf eine neue Version: Stack öffnen → „Update the stack“ mit **„Re-pull image“ an**.

### Selbst bauen

```bash
git clone https://github.com/maximiliansr/stammbaum.git stammbaum && cd stammbaum
cp .env.example .env            # Passwörter eintragen
docker build -t stammbaum:latest .
```

Ohne Docker (Node.js ≥ 20): `FAMILY_PASSWORD=test ADMIN_PASSWORD=geheim node server.js`

### Öffentlich mit HTTPS

`docker-compose.yml` enthält Caddy, der automatisch ein Let's-Encrypt-Zertifikat holt:
`.env` anlegen (`DOMAIN`, Passwörter), `docker compose up -d`.
Mit vorhandenem Reverse-Proxy (Nginx Proxy Manager, Traefik …) nur den Dienst `stammbaum` nutzen,
auf Port 3000 weiterleiten und `COOKIE_SECURE=true` setzen. Ohne offene Ports: Cloudflare Tunnel oder Tailscale.

---

## Einstellungen

| Variable | Bedeutung | Standard |
|---|---|---|
| `FAMILY_PASSWORD` | Gemeinsames Passwort für alle (lesen, vorschlagen) | – (Pflicht) |
| `ADMIN_PASSWORD` | Passwort für die Verwaltung – lang und geheim | – (Pflicht) |
| `SITE_TITLE` | Titel überschreiben | aus den Daten |
| `FAMILY_SEES_ADDRESSES` | `false` blendet Straße/PLZ für Familienmitglieder aus | `true` |
| `BEISPIELDATEN` | Beim ersten Start Beispielfamilie laden | `true` |
| `BACKUP_DAYS` | Anzahl täglicher Sicherungen | `90` |
| `COOKIE_SECURE` | `true` hinter HTTPS | `false` |
| `TRUST_PROXY` | `true` hinter Reverse-Proxy (für IP-basierte Sperre bei Fehlversuchen) | `false` |
| `DOMAIN` | Domain für Caddy (nur docker-compose) | – |

Passwort ändern → Container neu starten. Alle Anmeldungen und die alte Kalender-Abo-Adresse werden ungültig.

## Eigene Daten übernehmen

- **Leer starten** (`BEISPIELDATEN=false`), als Admin anmelden → „Erste Person anlegen“.
- **Vorhandene Datei einlesen**: Verwaltung → „Sichern & Einlesen“. Akzeptiert eigene Exporte und Exporte des
  früheren HTML-Stammbaums (Format mit `tree` und `edits`). Umwandeln per Kommandozeile:
  `node scripts/convert-legacy.js alt.json neu.json`
- **Beispielfamilie loswerden**, nachdem sie geladen wurde: Container stoppen, `data/` leeren, mit
  `BEISPIELDATEN=false` neu starten – oder einfach eine eigene Datei einlesen (ersetzt alles).

## Daten & Sicherung

Alles liegt im Datenordner (`/data` im Container):

| Datei/Ordner | Inhalt |
|---|---|
| `stammbaum.json` | Alle Personen und Quellen-Verweise |
| `vorschlaege.json` | Eingereichte Vorschläge |
| `protokoll.jsonl` | Jede Änderung mit Zeit und Urheber |
| `fotos/`, `quellen/` | Porträts und Dokumente |
| `backups/` | Tägliche Sicherungen + Sicherung vor jedem Import |

Den Datenordner zusätzlich extern sichern (z. B. Proxmox-Backup des LXC oder NAS-Backup).

## Datenschutz

- Der Dienst enthält Namen, Geburtsdaten und ggf. Adressen lebender Personen. Er ist passwortgeschützt,
  wird nicht von Suchmaschinen erfasst und lädt nichts von fremden Servern.
- Familie kurz informieren, dass ihre Daten hier stehen; Wünsche nach Löschung oder Ausblenden respektieren.
- **Echte Familiendaten gehören nie ins Repository.** `data/`, `.env` und typische Exportnamen sind in
  `.gitignore` ausgeschlossen – trotzdem vor jedem Commit `git status` prüfen.

## Aufbau

```
server.js          HTTP-Server, Anmeldung, API (nur Node-Standardbibliothek)
lib/               Datenmodell, Ablage/Sicherung, Import, Kalender (ICS)
public/            Oberfläche (HTML/CSS/JS ohne Framework, Schriften lokal)
seed/beispiel.json Erfundene Beispielfamilie
scripts/           Beispieldaten erzeugen, alte Exporte umwandeln
```

## Versionen

Unten auf jeder Seite steht die laufende Version, z. B. „Stammbaum v1.1.0 · e2ec756“ – die Nummer aus
`package.json` und der Commit, aus dem das Image gebaut wurde (verlinkt auf GitHub). Auch `/healthz` liefert beides.

Neue Version veröffentlichen: `version` in `package.json` erhöhen, committen und einen Tag setzen
(`git tag v1.2.0 && git push --tags`). Dann gibt es zusätzlich zum Image `:latest` auch `:1.2.0`.

## Lizenz

MIT – siehe [LICENSE](LICENSE). Schriften: Literata und IBM Plex Sans (SIL Open Font License).
