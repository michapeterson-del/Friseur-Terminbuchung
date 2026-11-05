'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { availableSlots } = require('../lib/slots');
const { toHHMM } = require('../lib/time');

// 2026-11-09 ist ein Montag
const MONDAY = '2026-11-09';
const salon = (extra = {}) => ({
  slotStep: 30,
  capacity: 1,
  minLeadMinutes: 0,
  horizonDays: 60,
  closedDates: [],
  hours: { 1: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '15:00' }] },
  ...extra,
});
const before = { date: '2026-11-01', minutes: 0 };
const slots = (s, dur, bookings = [], now = before, date = MONDAY) => availableSlots(s, { duration: dur }, date, bookings, now).map(toHHMM);

test('Färben (90 Min.) passt nur, wenn die ganze Dauer in die Öffnungszeit fällt – Pause wird respektiert', () => {
  assert.deepEqual(slots(salon(), 90), ['09:00', '09:30', '10:00', '10:30', '13:00', '13:30']);
});

test('Bestehende Termine blockieren überlappende Startzeiten', () => {
  const b = [{ date: MONDAY, start: 600, end: 660, status: 'confirmed' }]; // 10:00–11:00
  assert.deepEqual(slots(salon(), 30, b), ['09:00', '09:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30']);
});

test('Offene Anfragen blockieren auch, abgelehnte und stornierte nicht', () => {
  const pending = [{ date: MONDAY, start: 540, end: 720, status: 'pending' }];
  assert.deepEqual(slots(salon(), 60, pending), ['13:00', '13:30', '14:00']);
  const freed = [
    { date: MONDAY, start: 540, end: 720, status: 'declined' },
    { date: MONDAY, start: 780, end: 900, status: 'cancelled' },
  ];
  assert.equal(slots(salon(), 60, freed).length, 8);
});

test('Mehrere Plätze erlauben parallele Termine', () => {
  const b = [{ date: MONDAY, start: 540, end: 600, status: 'confirmed' }];
  assert.ok(slots(salon({ capacity: 2 }), 60, b).includes('09:00'));
  assert.ok(!slots(salon({ capacity: 1 }), 60, b).includes('09:00'));
});

test('Geschlossene Tage, Ruhetage und Vorlaufzeit', () => {
  assert.deepEqual(slots(salon({ closedDates: [{ date: MONDAY }] }), 30), []);
  assert.deepEqual(slots(salon(), 30, [], before, '2026-11-10'), []); // Dienstag ohne Öffnungszeit
  const now = { date: MONDAY, minutes: 10 * 60 + 5 }; // 10:05
  assert.deepEqual(slots(salon({ minLeadMinutes: 60 }), 30, [], now), ['11:30', '13:00', '13:30', '14:00', '14:30']);
});

test('Keine Termine in der Vergangenheit oder jenseits des Buchungszeitraums', () => {
  assert.deepEqual(slots(salon(), 30, [], { date: '2026-11-10', minutes: 0 }), []);
  assert.deepEqual(slots(salon({ horizonDays: 3 }), 30), []);
});
