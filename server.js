'use strict';

const http = require('node:http');
const path = require('node:path');
const { Store, id } = require('./lib/store');
const { createApp, newSalon } = require('./lib/app');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');

const store = new Store(DATA_FILE);

// Beim ersten Start einen Demo-Salon anlegen, damit man sofort etwas sieht.
if (store.data.salons.length === 0 && process.env.NO_DEMO !== '1') {
  const demo = newSalon({ name: 'Salon Schnittpunkt', slug: 'demo', email: 'demo@salon.de', password: 'demo1234' });
  Object.assign(demo, {
    tagline: 'Schnitt, Farbe und Pflege – mitten in der Stadt.',
    address: 'Hauptstraße 12, 10115 Berlin',
    phone: '030 1234567',
    capacity: 2,
    services: [
      { name: 'Herrenhaarschnitt', duration: 30, price: 28, description: 'Waschen, Schneiden, Styling' },
      { name: 'Damenhaarschnitt', duration: 60, price: 49, description: 'Waschen, Schneiden, Föhnen' },
      { name: 'Färben', duration: 90, price: 69, description: 'Ansatz oder komplett, inkl. Pflege' },
      { name: 'Strähnchen', duration: 120, price: 89, description: 'Foliensträhnen oder Balayage' },
      { name: 'Bartpflege', duration: 20, price: 15, description: 'Konturen und Trimmen' },
    ].map((s) => ({ id: id(), active: true, ...s })),
  });
  store.data.salons.push(demo);
  store.save();
  console.log('Demo-Salon angelegt: /s/demo  (Login: demo@salon.de / demo1234)');
}

http.createServer(createApp(store)).listen(PORT, () => {
  console.log(`Friseur-Terminbuchung läuft auf http://localhost:${PORT}`);
});
