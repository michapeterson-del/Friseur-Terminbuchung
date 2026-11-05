# Friseur-Terminbuchung

Online-Terminbuchung für **einen** Friseursalon, im Apple-Designstil (nach den Human Interface Guidelines).

- **Kunden** öffnen die Startseite, wählen Leistung, Tag und freie Uhrzeit und senden eine Terminanfrage. Über einen persönlichen Link sehen sie live, ob der Salon bestätigt hat, und können selbst stornieren.
- **Der Friseur** meldet sich unter `/admin` mit seinem Passwort an und stellt alles selbst ein:
  - **Termine**: Anfragen bestätigen, ablehnen oder absagen, jeweils mit Nachricht an den Kunden
  - **Leistungen** mit Dauer (z. B. Färben = 1,5 Std.), Preis, Beschreibung, ein-/ausblendbar
  - **Öffnungszeiten** pro Wochentag, mit mehreren Zeiträumen für Pausen
  - **Urlaub & Schließtage**
  - **Einstellungen**: Name, Adresse, Telefon, Zeitraster, Plätze gleichzeitig, Vorlaufzeit, wie weit im Voraus buchbar

Freie Zeiten werden aus Öffnungszeiten, Dauer der Leistung und bestehenden Terminen berechnet. Offene Anfragen blockieren den Platz schon, damit keine Doppelbuchungen entstehen.

## Lokal starten

Benötigt nur Node.js ab Version 20, keine weiteren Pakete.

```bash
npm start          # http://localhost:3000
npm test           # automatische Tests
```

Lokal gibt es ein Test-Passwort für `/admin`: `admin1234`.

## Deployment mit Coolify

1. In Coolify: **+ New → Resource → Repository** → dieses Repository, Branch `main`.
2. **Build Pack: `Dockerfile`**, **Ports Exposes: `3000`**.
3. **Domain** eintragen, z. B. `https://termine.dein-salon.de`.
4. **Persistent Storage → Volume** mit **Destination Path `/app/data`**. Ohne Volume sind nach jedem Deploy alle Termine weg.
5. **Environment Variables**:

   | Variable | Pflicht | Bedeutung |
   |---|---|---|
   | `ADMIN_PASSWORD` | ja | Passwort für den Friseur-Login unter `/admin` (lang und zufällig) |
   | `SALON_NAME` | nein | Name beim allerersten Start, später unter Einstellungen änderbar |
   | `TZ_SALON` | nein | Zeitzone, Standard `Europe/Berlin` |

   Das Passwort wird bei jedem Start übernommen. Vergessen? Einfach in Coolify neu setzen und neu deployen.
   Fehlt es, ist der Login gesperrt (die Buchungsseite läuft trotzdem). Nach 5 falschen Versuchen ist der Login 5 Minuten gesperrt.
6. **Deploy**.

Healthcheck: `/api/health`. Hinter dem HTTPS-Proxy wird das Login-Cookie automatisch als `Secure` gesetzt.

**Backup:** Alle Daten liegen in einer Datei, `/app/data/db.json` im Volume.

## Aufbau

```
server.js          Start, Salon anlegen, Zugangsdaten aus Umgebungsvariablen
lib/app.js         HTTP-Routen (Buchungsseite, Login, Friseur-Bereich)
lib/slots.js       Berechnung freier Zeiten
lib/store.js       JSON-Speicher, Passwort-Hashing (scrypt)
lib/time.js        Datums- und Zeithilfen
public/            Seiten, Skripte, styles.css mit den Design-Tokens, Schrift Inter (lokal, SIL OFL)
test/              Tests (node:test)
```

## Noch nicht enthalten

- E-Mail- oder SMS-Benachrichtigungen
- Mehrere Mitarbeiter mit eigenen Kalendern (stattdessen: „Plätze gleichzeitig“)
