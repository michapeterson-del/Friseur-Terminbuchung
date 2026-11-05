'use strict';

const { toMinutes, weekday, daysBetween } = require('./time');

// Status, die einen Zeitraum belegen. Abgelehnte und stornierte Termine geben den Platz wieder frei.
const BLOCKING = new Set(['pending', 'confirmed']);

/**
 * Berechnet die freien Startzeiten (Minuten) für eine Leistung an einem Tag.
 *
 * @param {object} salon     Salon mit hours, slotStep, capacity, minLeadMinutes, horizonDays, closedDates
 * @param {object} service   Leistung mit duration (Minuten)
 * @param {string} date      "YYYY-MM-DD"
 * @param {Array}  bookings  alle Buchungen dieses Salons
 * @param {{date:string, minutes:number}} now  aktuelle Salonzeit
 */
function availableSlots(salon, service, date, bookings, now) {
  const offset = daysBetween(now.date, date);
  if (offset < 0 || offset > salon.horizonDays) return [];
  if ((salon.closedDates || []).some((c) => c.date === date)) return [];

  const intervals = (salon.hours && salon.hours[weekday(date)]) || [];
  const step = Math.max(5, Number(salon.slotStep) || 15);
  const capacity = Math.max(1, Number(salon.capacity) || 1);
  const duration = Number(service.duration);
  const earliest = offset === 0 ? now.minutes + (Number(salon.minLeadMinutes) || 0) : -Infinity;

  const taken = bookings
    .filter((b) => b.date === date && BLOCKING.has(b.status))
    .map((b) => [b.start, b.end]);

  const result = [];
  for (const iv of intervals) {
    const open = toMinutes(iv.start);
    const close = toMinutes(iv.end);
    if (open === null || close === null) continue;
    for (let t = open; t + duration <= close; t += step) {
      if (t < earliest) continue;
      const overlapping = taken.filter(([s, e]) => s < t + duration && t < e).length;
      if (overlapping < capacity) result.push(t);
    }
  }
  return [...new Set(result)].sort((a, b) => a - b);
}

module.exports = { availableSlots, BLOCKING };
