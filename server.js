'use strict';

const http = require('node:http');
const path = require('node:path');
const { Store, id, hashPassword } = require('./lib/store');
const { createApp, newSalon } = require('./lib/app');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const PRODUCTION = process.env.NODE_ENV === 'production';

// Das Friseur-Passwort kommt aus der Umgebungsvariable ADMIN_PASSWORD (in Coolify: Environment Variables).
// Ohne Angabe gibt es nur lokal ein Test-Passwort; im Betrieb ist der Login dann gesperrt.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (PRODUCTION ? '' : 'admin1234');

const store = new Store(DATA_FILE);
let salon = store.data.salons[0];

if (!salon) {
  salon = newSalon({ name: process.env.SALON_NAME || 'Mein Salon', password: ADMIN_PASSWORD || id(24) });
  Object.assign(salon, {
    tagline: 'Schnitt, Farbe und Pflege',
    services: [
      { name: 'Herrenhaarschnitt', duration: 30, price: 28, description: 'Waschen, Schneiden, Styling' },
      { name: 'Damenhaarschnitt', duration: 60, price: 49, description: 'Waschen, Schneiden, Föhnen' },
      { name: 'Färben', duration: 90, price: 69, description: 'Ansatz oder komplett, inkl. Pflege' },
      { name: 'Strähnchen', duration: 120, price: 89, description: 'Foliensträhnen oder Balayage' },
      { name: 'Bartpflege', duration: 20, price: 15, description: 'Konturen und Trimmen' },
    ].map((s) => ({ id: id(), active: true, ...s })),
  });
  store.data.salons.push(salon);
  console.log('Salon angelegt. Leistungen, Öffnungszeiten und Daten unter /admin anpassen.');
}

// Bei jedem Start Zugangsdaten aus den Umgebungsvariablen übernehmen.
// So lässt sich ein vergessenes Passwort einfach in Coolify neu setzen.
if (ADMIN_PASSWORD) {
  const { salt, hash } = hashPassword(ADMIN_PASSWORD);
  delete salon.email;
  Object.assign(salon, { salt, passwordHash: hash });
  if (!PRODUCTION && !process.env.ADMIN_PASSWORD) console.log(`Test-Passwort für /admin: ${ADMIN_PASSWORD}`);
} else {
  // Kein Zugang konfiguriert: altes Passwort (z. B. aus der Demo) ungültig machen.
  const { salt, hash } = hashPassword(id(24));
  Object.assign(salon, { salt, passwordHash: hash });
  store.data.sessions = {};
  console.warn('ACHTUNG: ADMIN_PASSWORD fehlt – der Friseur-Login ist gesperrt.');
}
store.save();

http.createServer(createApp(store)).listen(PORT, () => {
  console.log(`Friseur-Terminbuchung läuft auf http://localhost:${PORT}`);
});
