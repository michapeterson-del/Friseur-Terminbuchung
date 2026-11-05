'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store');
const { createApp, newSalon } = require('../lib/app');

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friseur-'));
  const store = new Store(path.join(dir, 'db.json'));
  store.data.salons.push(newSalon({ name: 'Haarwerk', password: 'geheim123' }));
  const server = http.createServer(createApp(store, { now: () => ({ date: '2026-11-05', minutes: 8 * 60 }) }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, { auth = true } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth && cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  const login = () => call('POST', '/api/auth/login', { password: 'geheim123' });
  return { call, login, close: () => server.close(), store };
}

test('Kompletter Ablauf: Leistung einstellen, Kunde bucht, Friseur bestätigt', async (t) => {
  const { call, login, close } = await setup();
  t.after(close);

  let r = await login();
  assert.equal(r.status, 200);
  assert.equal(r.data.passwordHash, undefined, 'Passwort-Hash darf nie ausgeliefert werden');

  // Leistung "Färben" mit 90 Minuten
  r = await call('POST', '/api/admin/services', { name: 'Färben', duration: 90, price: 69 });
  assert.equal(r.status, 201);
  const serviceId = r.data.services[0].id;

  // Öffnungszeit Freitag 9–12
  await call('PUT', '/api/admin/hours', { hours: { 5: [{ start: '09:00', end: '12:00' }] } });

  // Öffentliche Salon-Daten
  r = await call('GET', '/api/salon', null, { auth: false });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'Haarwerk');
  assert.equal(r.data.passwordHash, undefined);

  // Kunde sieht freie Zeiten am Freitag, 2026-11-06
  r = await call('GET', `/api/salon/slots?serviceId=${serviceId}&date=2026-11-06`, null, { auth: false });
  assert.deepEqual(r.data.slots, ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30']);

  // Kunde bucht
  r = await call('POST', '/api/salon/bookings', { serviceId, date: '2026-11-06', time: '09:00', name: 'Lena', phone: '0151 123' }, { auth: false });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'pending');
  assert.equal(r.data.end, '10:30');
  const { token, id } = r.data;

  // Überlappender Termin → 409, keine Doppelbuchung
  r = await call('POST', '/api/salon/bookings', { serviceId, date: '2026-11-06', time: '10:00', name: 'Max', phone: '1' }, { auth: false });
  assert.equal(r.status, 409);

  // Friseur bestätigt mit Nachricht
  r = await call('POST', `/api/admin/bookings/${id}/status`, { status: 'confirmed', message: 'Bis Freitag!' });
  assert.equal(r.data.status, 'confirmed');

  // Kunde sieht Bestätigung
  r = await call('GET', `/api/bookings/${token}`, null, { auth: false });
  assert.equal(r.data.status, 'confirmed');
  assert.equal(r.data.message, 'Bis Freitag!');
  assert.equal(r.data.salon.name, 'Haarwerk');
});

test('Friseur-Bereich ist geschützt, Registrierung gibt es nicht, Eingaben werden geprüft', async (t) => {
  const { call, login, close } = await setup();
  t.after(close);

  let r = await call('GET', '/api/admin/bookings');
  assert.equal(r.status, 401);

  r = await call('POST', '/api/auth/register', { name: 'X', email: 'x@b.de', password: 'geheim123' });
  assert.equal(r.status, 404, 'Fremde können keinen Salon anlegen');

  r = await call('POST', '/api/auth/login', { password: 'falsch123' });
  assert.equal(r.status, 401);

  await login();
  r = await call('POST', '/api/admin/services', { name: 'Färben', duration: 0 });
  assert.equal(r.status, 400);
  r = await call('PUT', '/api/admin/hours', { hours: { 1: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '14:00' }] } });
  assert.equal(r.status, 400, 'Überschneidende Zeiträume werden abgelehnt');

  await call('POST', '/api/auth/logout');
  r = await call('GET', '/api/admin/me');
  assert.equal(r.status, 401);
});

test('Startseite ist die Buchungsseite', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friseur-'));
  const store = new Store(path.join(dir, 'db.json'));
  store.data.salons.push(newSalon({ name: 'A', password: 'geheim123' }));
  const server = http.createServer(createApp(store));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const html = await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
  assert.match(html, /js\/salon\.js/);
});

test('Login wird nach 5 Fehlversuchen gesperrt', async (t) => {
  const { call, close } = await setup();
  t.after(close);
  for (let i = 0; i < 5; i += 1) {
    const r = await call('POST', '/api/auth/login', { password: 'falsch' });
    assert.equal(r.status, 401);
  }
  const r = await call('POST', '/api/auth/login', { password: 'geheim123' });
  assert.equal(r.status, 429, 'Auch das richtige Passwort wird während der Sperre abgewiesen');
});

test('Kalender: Friseur trägt Termin und Blocker ein, Tag wird als ausgebucht erkannt', async (t) => {
  const { call, login, close } = await setup();
  t.after(close);
  await login();
  let r = await call('POST', '/api/admin/services', { name: 'Schnitt', duration: 60 });
  const serviceId = r.data.services[0].id;
  await call('PUT', '/api/admin/hours', { hours: { 5: [{ start: '09:00', end: '11:00' }] } });

  // Termin von Hand (z. B. telefonisch) – ist sofort bestätigt
  r = await call('POST', '/api/admin/bookings', { date: '2026-11-06', time: '09:00', serviceId, name: 'Herr Meier', phone: '0170 1' });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'confirmed');

  // Blocker für den Rest des Vormittags
  r = await call('POST', '/api/admin/bookings', { kind: 'block', date: '2026-11-06', time: '10:00', duration: 60, title: 'Arzttermin' });
  assert.equal(r.status, 201);
  const blockId = r.data.id;

  // Überschneidung wird gemeldet, mit force trotzdem möglich
  r = await call('POST', '/api/admin/bookings', { date: '2026-11-06', time: '09:30', serviceId, name: 'Frau Kunz' });
  assert.equal(r.status, 409);

  // Tag ist voll – Kunden sehen keine Zeiten mehr
  r = await call('GET', '/api/admin/calendar?from=2026-11-06&days=1');
  assert.deepEqual(r.data.days['2026-11-06'], { open: true, closed: false, confirmed: 1, pending: 0, load: 1, full: true });
  r = await call('GET', `/api/salon/slots?serviceId=${serviceId}&date=2026-11-06`, null, { auth: false });
  assert.deepEqual(r.data.slots, []);

  // Tagesansicht enthält beide Einträge
  r = await call('GET', '/api/admin/day?date=2026-11-06');
  assert.deepEqual(r.data.bookings.map((b) => b.kind), ['appointment', 'block']);

  // Blocker löschen gibt die Zeit wieder frei
  await call('DELETE', `/api/admin/bookings/${blockId}`);
  r = await call('GET', `/api/salon/slots?serviceId=${serviceId}&date=2026-11-06`, null, { auth: false });
  assert.deepEqual(r.data.slots, ['10:00']);
});

test('Kunde findet seine Termine nur mit passendem Namen und Kontakt', async (t) => {
  const { call, login, close } = await setup();
  t.after(close);
  await login();
  const r = await call('POST', '/api/admin/services', { name: 'Schnitt', duration: 30 });
  const serviceId = r.data.services[0].id;
  await call('PUT', '/api/admin/hours', { hours: { 5: [{ start: '09:00', end: '12:00' }] } });
  await call('POST', '/api/salon/bookings', { serviceId, date: '2026-11-06', time: '09:00', name: 'Lena Muster', phone: '0151 234 567' }, { auth: false });

  const find = (name, contact) => call('POST', '/api/bookings/lookup', { name, contact }, { auth: false });
  assert.equal((await find('lena muster', '+49 151 234567')).data.bookings.length, 1, 'Schreibweise der Nummer egal');
  assert.equal((await find('Lena Muster', '0151 999 999')).data.bookings.length, 0, 'falsche Nummer');
  assert.equal((await find('Max Muster', '0151 234 567')).data.bookings.length, 0, 'falscher Name');
});
