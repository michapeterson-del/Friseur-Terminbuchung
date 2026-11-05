# Friseur-Terminbuchung

Online-Terminbuchung für Friseursalons im Apple-Designstil (nach den Human Interface Guidelines).

- **Kunden** wählen Leistung, Tag und freie Uhrzeit und senden eine Terminanfrage. Über einen persönlichen Link sehen sie live, ob der Salon bestätigt hat, und können selbst stornieren.
- **Friseure** legen in einer Minute ihren eigenen Salon an und bekommen eine eigene Buchungsseite (`/s/<name>`). Im Friseur-Bereich (`/admin`) stellen sie alles selbst ein:
  - **Leistungen** mit Dauer (z. B. Färben = 1,5 Std.), Preis, Beschreibung, ein-/ausblendbar
  - **Öffnungszeiten** pro Wochentag, mit mehreren Zeiträumen für Pausen
  - **Urlaub & Schließtage**
  - **Buchungsregeln**: Zeitraster, Plätze gleichzeitig, Vorlaufzeit, wie weit im Voraus buchbar
  - **Anfragen** bestätigen, ablehnen oder absagen, jeweils mit Nachricht an den Kunden

Freie Zeiten werden aus Öffnungszeiten, Dauer der Leistung und bestehenden Terminen berechnet. Offene Anfragen blockieren den Platz schon, damit keine Doppelbuchungen entstehen.

## Starten

Benötigt nur Node.js ab Version 20, keine weiteren Pakete.

```bash
npm start          # http://localhost:3000
npm test           # automatische Tests
```

Beim ersten Start wird ein Demo-Salon angelegt:

- Buchungsseite: http://localhost:3000/s/demo
- Friseur-Bereich: http://localhost:3000/admin (Login: `demo@salon.de` / `demo1234`)

### Einstellungen über Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `DATA_FILE` | `data/db.json` | Speicherort der Daten |
| `TZ_SALON` | `Europe/Berlin` | Zeitzone für „heute“ und die Vorlaufzeit |
| `NO_DEMO` | – | `1` = keinen Demo-Salon anlegen |

## Deployment mit Coolify

Das Projekt enthält ein `Dockerfile`, Coolify baut es direkt aus GitHub.

1. In Coolify: **+ New → Resource → Public/Private Repository (GitHub App)** → dieses Repository, Branch `main`.
2. **Build Pack: `Dockerfile`** auswählen.
3. **Ports Exposes: `3000`**.
4. **Domain** eintragen, z. B. `https://termine.deine-domain.de` (Coolify holt das HTTPS-Zertifikat automatisch).
5. **Persistent Storage → + Add → Volume**:
   - Name: `friseur-data`
   - Destination Path: `/app/data`

   **Wichtig:** Ohne dieses Volume sind bei jedem Deploy alle Salons und Buchungen weg.
6. **Environment Variables** (optional): `NO_DEMO=1`, wenn kein Demo-Salon angelegt werden soll, und `TZ_SALON`, falls nicht Europe/Berlin.
7. **Deploy**.

Ein Healthcheck ist im Image eingebaut (`/api/health`). Hinter dem HTTPS-Proxy von Coolify wird das Login-Cookie automatisch als `Secure` gesetzt.

**Backup:** Alle Daten liegen in einer einzigen Datei, `/app/data/db.json` im Volume. Am einfachsten über **Persistent Storage** bzw. per `docker cp` sichern.

## Aufbau

```
server.js          Start, Demo-Daten
lib/app.js         HTTP-Routen (öffentliche API, Anmeldung, Friseur-Bereich)
lib/slots.js       Berechnung freier Zeiten
lib/store.js       JSON-Speicher, Passwort-Hashing (scrypt)
lib/time.js        Datums- und Zeithilfen
public/            Seiten, Skripte und styles.css mit den Design-Tokens
test/              Tests (node:test)
```

## Noch nicht enthalten

- E-Mail- oder SMS-Benachrichtigungen (der Kunde sieht den Status über seinen Buchungslink, der Friseur sieht neue Anfragen im Friseur-Bereich)
- Mehrere Mitarbeiter mit eigenen Kalendern (stattdessen: „Plätze gleichzeitig“)
- Passwort zurücksetzen
