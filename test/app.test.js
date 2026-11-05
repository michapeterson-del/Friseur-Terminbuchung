'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store');
const { createApp } = require('../lib/app');

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friseur-'));
  const store = new Store(path.join(dir, 'db.json'));
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
  return { call, close: () => server.close(), store };
}

test('Kompletter Ablauf: Salon anlegen, Leistung einstellen, Kunde bucht, Friseur bestätigt', async (t) => {
  const { call, close } = await setup();
  t.after(close);

  // Friseur registriert sich
  let r = await call('POST', '/api/auth/register', { name: 'Haarwerk', slug: 'haarwerk', email: 'a@b.de', password: 'geheim123' });
  assert.equal(r.status, 201);
  assert.equal(r.data.passwordHash, undefined, 'Passwort-Hash darf nie ausgeliefert werden');

  // Salon erscheint in der öffentlichen Liste
  r = await call('GET', '/api/salons', null, { auth: false });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.map((s) => s.slug), ['haarwerk']);

  // Leistung "Färben" mit 90 Minuten
  r = await call('POST', '/api/admin/services', { name: 'Färben', duration: 90, price: 69 });
  assert.equal(r.status, 201);
  const serviceId = r.data.services[0].id;

  // Öffnungszeit Freitag 9–12
  await call('PUT', '/api/admin/hours', { hours: { 5: [{ start: '09:00', end: '12:00' }] } });

  // Kunde sieht freie Zeiten am Freitag, 2026-11-06
  r = await call('GET', `/api/salons/haarwerk/slots?serviceId=${serviceId}&date=2026-11-06`, null, { auth: false });
  assert.deepEqual(r.data.slots, ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30']);

  // Kunde bucht
  r = await call('POST', '/api/salons/haarwerk/bookings', { serviceId, date: '2026-11-06', time: '09:00', name: 'Lena', phone: '0151 123' }, { auth: false });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'pending');
  assert.equal(r.data.end, '10:30');
  const { token, id } = r.data;

  // Gleicher Slot noch einmal → 409, keine Doppelbuchung
  r = await call('POST', '/api/salons/haarwerk/bookings', { serviceId, date: '2026-11-06', time: '10:00', name: 'Max', phone: '1' }, { auth: false });
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

test('Friseur-Bereich ist geschützt und Eingaben werden geprüft', async (t) => {
  const { call, close } = await setup();
  t.after(close);

  let r = await call('GET', '/api/admin/bookings');
  assert.equal(r.status, 401);

  r = await call('POST', '/api/auth/register', { name: 'X', slug: 'Ungültig!', email: 'a@b.de', password: 'geheim123' });
  assert.equal(r.status, 400);

  await call('POST', '/api/auth/register', { name: 'X', slug: 'salon-x', email: 'x@b.de', password: 'geheim123' });
  r = await call('POST', '/api/admin/services', { name: 'Färben', duration: 0 });
  assert.equal(r.status, 400);
  r = await call('PUT', '/api/admin/hours', { hours: { 1: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '14:00' }] } });
  assert.equal(r.status, 400, 'Überschneidende Zeiträume werden abgelehnt');

  await call('POST', '/api/auth/logout');
  r = await call('POST', '/api/auth/login', { email: 'x@b.de', password: 'falsch123' });
  assert.equal(r.status, 401);
  r = await call('POST', '/api/auth/login', { email: 'x@b.de', password: 'geheim123' });
  assert.equal(r.status, 200);
});

test('Ein Friseur kann keine Buchungen eines anderen Salons ändern', async (t) => {
  const { call, close, store } = await setup();
  t.after(close);
  await call('POST', '/api/auth/register', { name: 'A', slug: 'salon-a', email: 'a@a.de', password: 'geheim123' });
  const r = await call('POST', '/api/admin/services', { name: 'Schnitt', duration: 30 });
  await call('PUT', '/api/admin/hours', { hours: { 5: [{ start: '09:00', end: '12:00' }] } });
  const b = await call('POST', '/api/salons/salon-a/bookings', { serviceId: r.data.services[0].id, date: '2026-11-06', time: '09:00', name: 'K', email: 'k@k.de' }, { auth: false });
  await call('POST', '/api/auth/register', { name: 'B', slug: 'salon-b', email: 'b@b.de', password: 'geheim123' });
  const res = await call('POST', `/api/admin/bookings/${b.data.id}/status`, { status: 'confirmed' });
  assert.equal(res.status, 404);
  assert.equal(store.data.bookings[0].status, 'pending');
});
