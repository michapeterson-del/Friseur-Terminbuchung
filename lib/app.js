'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { id, hashPassword, verifyPassword } = require('./store');
const { availableSlots, BLOCKING } = require('./slots');
const { toMinutes, toHHMM, isValidDate, addDays, nowInSalon, weekday } = require('./time');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_DAYS = 14;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => { throw new HttpError(status, message); };
const CREATED = Symbol('created');
const created = (body) => ({ [CREATED]: true, body });

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function defaultHours() {
  const day = [{ start: '09:00', end: '18:00' }];
  return { 0: [], 1: [], 2: day, 3: day, 4: day, 5: [{ start: '09:00', end: '20:00' }], 6: [{ start: '09:00', end: '14:00' }] };
}

function newSalon({ name, password }) {
  const { salt, hash } = hashPassword(password);
  return {
    id: id(),
    name,
    salt,
    passwordHash: hash,
    tagline: '',
    address: '',
    phone: '',
    slotStep: 15,
    capacity: 1,
    minLeadMinutes: 60,
    horizonDays: 60,
    hours: defaultHours(),
    closedDates: [],
    services: [],
    createdAt: new Date().toISOString(),
  };
}

function publicSalon(s) {
  return {
    name: s.name,
    tagline: s.tagline,
    address: s.address,
    phone: s.phone,
    horizonDays: s.horizonDays,
    hours: s.hours,
    closedDates: (s.closedDates || []).map((c) => c.date),
    services: s.services.filter((x) => x.active).map(({ id: sid, name, duration, price, description }) => ({
      id: sid, name, duration, price, description,
    })),
  };
}

function privateSalon(s) {
  const { salt, passwordHash, ...rest } = s;
  return rest;
}

function bookingView(b, salon) {
  return {
    id: b.id,
    token: b.token,
    kind: b.kind || 'appointment',
    status: b.status,
    date: b.date,
    start: toHHMM(b.start),
    end: toHHMM(b.end),
    service: { name: b.serviceName, duration: b.duration, price: b.price },
    customer: b.customer,
    message: b.message || '',
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    salon: salon ? { name: salon.name, address: salon.address, phone: salon.phone } : undefined,
  };
}

// Telefonnummern vergleichbar machen: nur Ziffern, ohne Ländervorwahl 49 und führende 0
function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('0049')) d = d.slice(4);
  else if (d.startsWith('49') && d.length >= 11) d = d.slice(2);
  return d.replace(/^0+/, '');
}
const normName = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Auslastung eines Tages: belegte Minuten / (Öffnungsminuten × Plätze).
// „Ausgebucht“ = durch Termine voll, unabhängig von der Uhrzeit (ein vergangener Nachmittag ist nicht „voll“).
function dayStats(salon, date, bookings, current) {
  const intervals = (salon.hours && salon.hours[weekday(date)]) || [];
  const closed = (salon.closedDates || []).some((c) => c.date === date);
  const openMinutes = closed ? 0 : intervals.reduce((sum, iv) => sum + (toMinutes(iv.end) - toMinutes(iv.start)), 0);
  const day = bookings.filter((b) => b.date === date);
  const active = day.filter((b) => BLOCKING.has(b.status));
  const appointments = active.filter((b) => (b.kind || 'appointment') === 'appointment');
  const capacity = Math.max(1, Number(salon.capacity) || 1);
  const booked = active.reduce((sum, b) => sum + (b.end - b.start), 0);
  const load = openMinutes ? Math.min(1, booked / (openMinutes * capacity)) : 0;
  const services = salon.services.filter((x) => x.active);
  const shortest = services.length ? services.reduce((a, b) => (a.duration <= b.duration ? a : b)) : null;
  const future = date >= current.date;
  const full = Boolean(openMinutes && future && shortest
    && availableSlots({ ...salon, minLeadMinutes: 0, horizonDays: 3650 }, shortest, date, bookings, { date: current.date, minutes: 0 }).length === 0);
  return {
    open: openMinutes > 0,
    closed,
    confirmed: appointments.filter((b) => b.status === 'confirmed').length,
    pending: appointments.filter((b) => b.status === 'pending').length,
    load: Math.round(load * 100) / 100,
    full,
  };
}

function validateService(input) {
  const name = text(input.name, 80);
  const duration = Number(input.duration);
  const price = input.price === '' || input.price == null ? null : Number(input.price);
  if (!name) fail(400, 'Bitte gib einen Namen für die Leistung ein.');
  if (!Number.isInteger(duration) || duration < 5 || duration > 600) {
    fail(400, 'Die Dauer muss zwischen 5 und 600 Minuten liegen.');
  }
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 10000)) fail(400, 'Der Preis ist ungültig.');
  return { name, duration, price, description: text(input.description, 300), active: input.active !== false };
}

function validateHours(input) {
  const hours = {};
  for (let d = 0; d < 7; d += 1) {
    const list = Array.isArray(input?.[d]) ? input[d] : [];
    const clean = list.map((iv) => {
      const s = toMinutes(iv.start);
      const e = toMinutes(iv.end);
      if (s === null || e === null || e <= s) fail(400, 'Jeder Zeitraum braucht eine Startzeit vor der Endzeit.');
      return { s, e };
    }).sort((a, b) => a.s - b.s);
    for (let i = 1; i < clean.length; i += 1) {
      if (clean[i].s < clean[i - 1].e) fail(400, 'Zeiträume am selben Tag dürfen sich nicht überschneiden.');
    }
    hours[d] = clean.map(({ s, e }) => ({ start: toHHMM(s), end: toHHMM(e) }));
  }
  return hours;
}

function createApp(store, { now = () => nowInSalon() } = {}) {
  const db = store.data;

  // Diese App gehört genau einem Salon.
  const findSalon = () => db.salons[0] || fail(503, 'Der Salon ist noch nicht eingerichtet.');
  const salonBookings = (salonId) => db.bookings.filter((b) => b.salonId === salonId);

  function auth(req) {
    const token = parseCookies(req.headers.cookie).session;
    const session = token && db.sessions[token];
    if (!session || session.expires < Date.now()) fail(401, 'Bitte melde dich an.');
    return db.salons.find((s) => s.id === session.salonId) || fail(401, 'Bitte melde dich an.');
  }

  const attempts = new Map();
  const lookups = new Map();
  // Letzter Eintrag = vom Proxy (Coolify/Traefik) angehängte echte Client-IP; vordere Einträge kann der Client fälschen.
  const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || '';

  // Hinter Coolify/Traefik kommt HTTPS über den Proxy; dann das Cookie nur über HTTPS senden.
  const secure = (req) => (String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? '; Secure' : '');

  function startSession(req, res, salon) {
    const token = id(24);
    db.sessions[token] = { salonId: salon.id, expires: Date.now() + SESSION_DAYS * 86400000 };
    for (const [t, s] of Object.entries(db.sessions)) if (s.expires < Date.now()) delete db.sessions[t];
    store.save();
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure(req)}`);
  }

  const routes = [
    // ---------- Öffentlich ----------
    ['GET', /^\/api\/health$/, () => ({ ok: true })],

    ['GET', /^\/api\/salon$/, () => publicSalon(findSalon())],

    ['GET', /^\/api\/salon\/availability$/, (req, m, query) => {
      const salon = findSalon();
      const service = salon.services.find((x) => x.id === query.get('serviceId') && x.active) || fail(404, 'Leistung nicht gefunden.');
      const current = now();
      const from = isValidDate(query.get('from')) ? query.get('from') : current.date;
      const days = Math.min(Math.max(Number(query.get('days')) || 14, 1), 62);
      const bookings = salonBookings(salon.id);
      const result = {};
      for (let i = 0; i < days; i += 1) {
        const date = addDays(from, i);
        result[date] = availableSlots(salon, service, date, bookings, current).length;
      }
      return { today: current.date, days: result };
    }],

    ['GET', /^\/api\/salon\/slots$/, (req, m, query) => {
      const salon = findSalon();
      const service = salon.services.find((x) => x.id === query.get('serviceId') && x.active) || fail(404, 'Leistung nicht gefunden.');
      const date = query.get('date');
      if (!isValidDate(date)) fail(400, 'Ungültiges Datum.');
      return { date, slots: availableSlots(salon, service, date, salonBookings(salon.id), now()).map(toHHMM) };
    }],

    ['POST', /^\/api\/salon\/bookings$/, (req, m, query, body) => {
      const salon = findSalon();
      const service = salon.services.find((x) => x.id === body.serviceId && x.active) || fail(400, 'Bitte wähle eine Leistung.');
      const start = toMinutes(body.time);
      if (!isValidDate(body.date) || start === null) fail(400, 'Bitte wähle einen Termin.');
      const customer = {
        name: text(body.name, 80),
        phone: text(body.phone, 40),
        email: text(body.email, 120),
        note: text(body.note, 500),
      };
      if (!customer.name) fail(400, 'Bitte gib deinen Namen an.');
      if (!customer.phone && !customer.email) fail(400, 'Bitte gib eine Telefonnummer oder E-Mail an.');
      if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) fail(400, 'Die E-Mail-Adresse ist ungültig.');

      // Verfügbarkeit erneut prüfen – direkt vor dem Speichern, damit keine Doppelbuchung entsteht.
      const free = availableSlots(salon, service, body.date, salonBookings(salon.id), now());
      if (!free.includes(start)) fail(409, 'Dieser Termin ist leider gerade vergeben worden. Bitte wähle eine andere Uhrzeit.');

      const booking = {
        id: id(),
        token: id(18),
        salonId: salon.id,
        serviceId: service.id,
        serviceName: service.name,
        duration: service.duration,
        price: service.price,
        date: body.date,
        start,
        end: start + service.duration,
        customer,
        status: 'pending',
        message: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.bookings.push(booking);
      store.save();
      return created(bookingView(booking, salon));
    }],

    // Kunde sucht seine Termine: Name + Telefon oder E-Mail müssen passen
    ['POST', /^\/api\/bookings\/lookup$/, (req, m, q, body) => {
      const ip = clientIp(req);
      const entry = lookups.get(ip) || { count: 0, since: Date.now() };
      if (Date.now() - entry.since > 10 * 60000) Object.assign(entry, { count: 0, since: Date.now() });
      entry.count += 1;
      if (lookups.size > 10000) lookups.clear();
      lookups.set(ip, entry);
      if (entry.count > 10) fail(429, 'Zu viele Suchanfragen. Bitte in ein paar Minuten erneut versuchen.');

      const name = normName(body.name);
      const contact = String(body.contact || '').trim();
      if (name.length < 2 || contact.length < 5) fail(400, 'Bitte gib deinen Namen und deine Telefonnummer oder E-Mail ein.');
      const isEmail = contact.includes('@');
      const phone = normPhone(contact);
      const today = now().date;
      const salon = findSalon();
      const found = salonBookings(salon.id)
        .filter((b) => (b.kind || 'appointment') === 'appointment' && b.date >= today && normName(b.customer.name) === name)
        .filter((b) => (isEmail
          ? b.customer.email && b.customer.email.toLowerCase() === contact.toLowerCase()
          : phone.length >= 6 && normPhone(b.customer.phone) === phone))
        .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
        .map((b) => bookingView(b, salon));
      return { bookings: found };
    }],

    ['GET', /^\/api\/bookings\/([\w-]+)$/, (req, [token]) => {
      const b = db.bookings.find((x) => x.token === token) || fail(404, 'Buchung nicht gefunden.');
      return bookingView(b, db.salons.find((s) => s.id === b.salonId));
    }],

    ['POST', /^\/api\/bookings\/([\w-]+)\/cancel$/, (req, [token]) => {
      const b = db.bookings.find((x) => x.token === token) || fail(404, 'Buchung nicht gefunden.');
      if (!BLOCKING.has(b.status)) fail(400, 'Diese Buchung kann nicht mehr storniert werden.');
      b.status = 'cancelled';
      b.updatedAt = new Date().toISOString();
      store.save();
      return bookingView(b, db.salons.find((s) => s.id === b.salonId));
    }],

    // ---------- Anmeldung ----------
    ['POST', /^\/api\/auth\/login$/, (req, m, q, body, res) => {
      // Nur ein Passwort – daher Schutz gegen Durchprobieren: nach 5 Fehlversuchen 5 Minuten Pause.
      const ip = clientIp(req);
      let entry = attempts.get(ip);
      if (entry && entry.blockedUntil && entry.blockedUntil <= Date.now()) {
        attempts.delete(ip);
        entry = undefined;
      }
      if (entry?.blockedUntil) {
        fail(429, `Zu viele Versuche. Bitte in ${Math.ceil((entry.blockedUntil - Date.now()) / 60000)} Min. erneut versuchen.`);
      }
      const salon = db.salons[0];
      if (!salon || !salon.passwordHash || !verifyPassword(body.password || '', salon.salt, salon.passwordHash)) {
        const count = (entry?.count || 0) + 1;
        if (attempts.size > 10000) attempts.clear();
        attempts.set(ip, { count, blockedUntil: count >= 5 ? Date.now() + 5 * 60000 : 0 });
        fail(401, 'Das Passwort ist falsch.');
      }
      attempts.delete(ip);
      startSession(req, res, salon);
      return privateSalon(salon);
    }],

    ['POST', /^\/api\/auth\/logout$/, (req, m, q, body, res) => {
      const token = parseCookies(req.headers.cookie).session;
      if (token && db.sessions[token]) {
        delete db.sessions[token];
        store.save();
      }
      res.setHeader('Set-Cookie', `session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure(req)}`);
      return { ok: true };
    }],

    // ---------- Friseur-Bereich ----------
    ['GET', /^\/api\/admin\/me$/, (req) => privateSalon(auth(req))],

    ['PUT', /^\/api\/admin\/salon$/, (req, m, q, body) => {
      const salon = auth(req);
      const name = text(body.name, 80);
      if (!name) fail(400, 'Der Salonname darf nicht leer sein.');
      const num = (v, min, max, label) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < min || n > max) fail(400, `${label} muss zwischen ${min} und ${max} liegen.`);
        return n;
      };
      Object.assign(salon, {
        name,
        tagline: text(body.tagline, 160),
        address: text(body.address, 160),
        phone: text(body.phone, 40),
        slotStep: num(body.slotStep, 5, 120, 'Der Zeitraster'),
        capacity: num(body.capacity, 1, 20, 'Die Anzahl der Plätze'),
        minLeadMinutes: num(body.minLeadMinutes, 0, 10080, 'Die Vorlaufzeit'),
        horizonDays: num(body.horizonDays, 1, 365, 'Der Buchungszeitraum'),
      });
      store.save();
      return privateSalon(salon);
    }],

    ['PUT', /^\/api\/admin\/hours$/, (req, m, q, body) => {
      const salon = auth(req);
      salon.hours = validateHours(body.hours);
      store.save();
      return privateSalon(salon);
    }],

    ['PUT', /^\/api\/admin\/closed-dates$/, (req, m, q, body) => {
      const salon = auth(req);
      const list = Array.isArray(body.closedDates) ? body.closedDates : [];
      const clean = list.map((c) => {
        if (!isValidDate(c.date)) fail(400, 'Ungültiges Datum bei den Schließtagen.');
        return { date: c.date, reason: text(c.reason, 80) };
      });
      salon.closedDates = [...new Map(clean.map((c) => [c.date, c])).values()].sort((a, b) => a.date.localeCompare(b.date));
      store.save();
      return privateSalon(salon);
    }],

    ['POST', /^\/api\/admin\/services$/, (req, m, q, body) => {
      const salon = auth(req);
      const service = { id: id(), ...validateService(body) };
      salon.services.push(service);
      store.save();
      return created(privateSalon(salon));
    }],

    ['PUT', /^\/api\/admin\/services\/([\w-]+)$/, (req, [sid], q, body) => {
      const salon = auth(req);
      const service = salon.services.find((x) => x.id === sid) || fail(404, 'Leistung nicht gefunden.');
      Object.assign(service, validateService(body));
      store.save();
      return privateSalon(salon);
    }],

    ['DELETE', /^\/api\/admin\/services\/([\w-]+)$/, (req, [sid]) => {
      const salon = auth(req);
      salon.services = salon.services.filter((x) => x.id !== sid);
      store.save();
      return privateSalon(salon);
    }],

    ['GET', /^\/api\/admin\/calendar$/, (req, m, query) => {
      const salon = auth(req);
      const current = now();
      const from = isValidDate(query.get('from')) ? query.get('from') : current.date;
      const days = Math.min(Math.max(Number(query.get('days')) || 42, 1), 62);
      const bookings = salonBookings(salon.id);
      const result = {};
      for (let i = 0; i < days; i += 1) {
        const date = addDays(from, i);
        result[date] = dayStats(salon, date, bookings, current);
      }
      return { today: current.date, days: result };
    }],

    ['GET', /^\/api\/admin\/day$/, (req, m, query) => {
      const salon = auth(req);
      const date = query.get('date');
      if (!isValidDate(date)) fail(400, 'Ungültiges Datum.');
      const current = now();
      const bookings = salonBookings(salon.id);
      return {
        date,
        today: current.date,
        nowMinutes: current.minutes,
        hours: (salon.hours && salon.hours[weekday(date)]) || [],
        closedReason: (salon.closedDates || []).find((c) => c.date === date)?.reason ?? null,
        capacity: salon.capacity,
        stats: dayStats(salon, date, bookings, current),
        bookings: bookings.filter((b) => b.date === date).sort((a, b) => a.start - b.start).map((b) => bookingView(b)),
      };
    }],

    // Friseur trägt selbst einen Termin oder einen Blocker (Pause, Urlaub, privat) ein
    ['POST', /^\/api\/admin\/bookings$/, (req, m, q, body) => {
      const salon = auth(req);
      const kind = body.kind === 'block' ? 'block' : 'appointment';
      const start = toMinutes(body.time);
      if (!isValidDate(body.date) || start === null) fail(400, 'Bitte Datum und Uhrzeit angeben.');
      let service = null;
      if (kind === 'appointment') {
        service = salon.services.find((x) => x.id === body.serviceId) || fail(400, 'Bitte wähle eine Leistung.');
      }
      const duration = service ? service.duration : Number(body.duration);
      if (!Number.isInteger(duration) || duration < 5 || duration > 24 * 60) fail(400, 'Die Dauer ist ungültig.');
      if (start + duration > 24 * 60) fail(400, 'Der Termin muss am selben Tag enden.');
      const name = text(body.name, 80);
      if (kind === 'appointment' && !name) fail(400, 'Bitte gib den Namen des Kunden ein.');

      if (!body.force) {
        const capacity = Math.max(1, Number(salon.capacity) || 1);
        const overlapping = salonBookings(salon.id).filter((b) => b.date === body.date && BLOCKING.has(b.status)
          && b.start < start + duration && start < b.end).length;
        if (overlapping >= capacity) fail(409, 'Zu dieser Zeit ist schon alles belegt.');
      }

      const booking = {
        id: id(),
        token: id(18),
        salonId: salon.id,
        kind,
        source: 'salon',
        serviceId: service?.id || null,
        serviceName: service ? service.name : (text(body.title, 80) || 'Blockiert'),
        duration,
        price: service ? service.price : null,
        date: body.date,
        start,
        end: start + duration,
        customer: { name: kind === 'block' ? '' : name, phone: text(body.phone, 40), email: text(body.email, 120), note: text(body.note, 500) },
        status: 'confirmed',
        message: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.bookings.push(booking);
      store.save();
      return created(bookingView(booking));
    }],

    ['DELETE', /^\/api\/admin\/bookings\/([\w-]+)$/, (req, [bid]) => {
      const salon = auth(req);
      const b = db.bookings.find((x) => x.id === bid && x.salonId === salon.id) || fail(404, 'Eintrag nicht gefunden.');
      if (b.kind !== 'block') fail(400, 'Kundentermine werden abgesagt, nicht gelöscht.');
      db.bookings = db.bookings.filter((x) => x !== b);
      store.save();
      return { ok: true };
    }],

    ['GET', /^\/api\/admin\/bookings$/, (req) => {
      const salon = auth(req);
      const list = salonBookings(salon.id)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
        .map((b) => bookingView(b));
      return { today: now().date, bookings: list };
    }],

    ['POST', /^\/api\/admin\/bookings\/([\w-]+)\/status$/, (req, [bid], q, body) => {
      const salon = auth(req);
      const b = db.bookings.find((x) => x.id === bid && x.salonId === salon.id) || fail(404, 'Buchung nicht gefunden.');
      const status = body.status;
      if (!['confirmed', 'declined', 'cancelled'].includes(status)) fail(400, 'Unbekannter Status.');
      if (status === 'confirmed' && b.status !== 'pending') fail(400, 'Nur offene Anfragen können bestätigt werden.');
      if (status === 'declined' && b.status !== 'pending') fail(400, 'Nur offene Anfragen können abgelehnt werden.');
      if (status === 'cancelled' && b.status !== 'confirmed') fail(400, 'Nur bestätigte Termine können abgesagt werden.');
      b.status = status;
      b.message = text(body.message, 300);
      b.updatedAt = new Date().toISOString();
      store.save();
      return bookingView(b);
    }],
  ];

  // Seiten (alles andere wird als statische Datei aus /public ausgeliefert)
  const pages = [
    [/^\/$/, 'index.html'],
    [/^\/buchung\/[\w-]+\/?$/, 'booking.html'],
    [/^\/admin\/?$/, 'admin.html'],
    [/^\/termine\/?$/, 'termine.html'],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const [method, pattern, fn] of routes) {
          const match = pattern.exec(url.pathname);
          if (!match || method !== req.method) continue;
          const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};
          const out = await fn(req, match.slice(1), url.searchParams, body, res);
          const [status, payload] = out && out[CREATED] ? [201, out.body] : [200, out];
          return sendJson(res, status, payload);
        }
        fail(404, 'Nicht gefunden.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Methode nicht erlaubt.');
      const page = pages.find(([p]) => p.test(url.pathname));
      const rel = page ? page[1] : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) fail(404, 'Seite nicht gefunden.');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file));
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (url.pathname.startsWith('/api/')) return sendJson(res, status, { error: status === 500 ? 'Interner Fehler.' : err.message });
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(err.message);
    }
  }

  return handle;
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) {
        reject(new HttpError(413, 'Anfrage zu groß.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Ungültige Daten.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

module.exports = { createApp, newSalon };
