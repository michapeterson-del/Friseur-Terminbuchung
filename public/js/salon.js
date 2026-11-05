import {
  api, esc, euro, duration, dow, dayNum, monthName, fmtDateLong, fmtDateShort, icons, toast, h, serviceIcon, WEEKDAYS,
} from './common.js';
import { savedTokens, rememberToken } from './mybookings.js';

const app = document.getElementById('app');
document.getElementById('brand').insertAdjacentHTML('afterbegin', icons.scissors);

const state = { salon: null, service: null, date: null, time: null, days: {}, today: null, from: null };
const WINDOW = 14;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollTo = (el) => el?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
const svg = (icon, size) => icon.replace('<svg', `<svg width="${size}" height="${size}"`);

const toMin = (hhmm) => { const [a, b] = hhmm.split(':').map(Number); return a * 60 + b; };
const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// „Heute geöffnet bis 18:00“ – nach lokaler Uhrzeit des Besuchers
function openStatus(s) {
  const now = new Date();
  const today = s.hours[now.getDay()] || [];
  const mins = now.getHours() * 60 + now.getMinutes();
  if (!s.closedDates.includes(localIso(now))) {
    const current = today.find((iv) => mins >= toMin(iv.start) && mins < toMin(iv.end));
    if (current) return { open: true, text: `Geöffnet · bis ${current.end} Uhr` };
    const later = today.find((iv) => mins < toMin(iv.start));
    if (later) return { open: false, text: `Geschlossen · öffnet um ${later.start} Uhr` };
  }
  for (let i = 1; i <= 7; i += 1) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    const ivs = s.hours[d.getDay()] || [];
    if (ivs.length && !s.closedDates.includes(localIso(d))) {
      return { open: false, text: `Geschlossen · öffnet ${i === 1 ? 'morgen' : WEEKDAYS[d.getDay()]} um ${ivs[0].start} Uhr` };
    }
  }
  return { open: false, text: 'Derzeit geschlossen' };
}

async function init() {
  try {
    state.salon = await api('/api/salon');
  } catch (e) {
    app.innerHTML = `<main class="container"><div class="alert"><span class="dot"></span>${esc(e.message)}</div></main>`;
    return;
  }
  const s = state.salon;
  document.title = `Termin buchen – ${s.name}`;
  document.getElementById('nav-name').textContent = s.name;
  const tel = s.phone ? `tel:${s.phone.replace(/[^\d+]/g, '')}` : '';
  if (tel) {
    const call = document.getElementById('call');
    call.href = tel;
    call.hidden = false;
  }
  const saved = savedTokens().length;
  if (saved) {
    const badge = document.getElementById('my-count');
    badge.textContent = saved;
    badge.hidden = false;
    badge.setAttribute('aria-label', `${saved} gespeichert`);
    badge.style.marginLeft = 'var(--space-1)';
  }
  const status = openStatus(s);
  const maps = s.address ? `https://maps.apple.com/?q=${encodeURIComponent(s.address)}` : '';
  const todayIdx = new Date().getDay();

  app.innerHTML = `
    <section class="hero-premium">
      <div class="hero-inner">
        <p class="eyebrow">Online-Termin</p>
        <h1 class="hero-title">${esc(s.name)}</h1>
        ${s.tagline ? `<p class="hero-tagline">${esc(s.tagline)}</p>` : ''}
        <div class="chips">
          <span class="chip"><span class="dot ${status.open ? 'open' : 'closed'}" aria-hidden="true"></span>${status.text}</span>
          ${s.address ? `<a class="chip" href="${maps}" target="_blank" rel="noopener">${icons.pin}${esc(s.address)}</a>` : ''}
          ${s.phone ? `<a class="chip" href="${tel}">${icons.phone}${esc(s.phone)}</a>` : ''}
        </div>
        <div class="hero-cta"><a class="btn btn-primary btn-large" href="#step-service" id="cta">Termin buchen</a></div>
      </div>
    </section>

    <div class="booking-layout">
      <main>
        <section class="step" id="step-service" aria-labelledby="h1">
          <div class="step-head"><span class="step-num">1</span><h2 id="h1">Leistung wählen</h2></div>
          <div class="services-grid" id="services"></div>
        </section>

        <section class="step is-locked" id="step-date" aria-labelledby="h2">
          <div class="step-head"><span class="step-num">2</span><h2 id="h2">Tag &amp; Uhrzeit</h2></div>
          <div id="date-body"><p class="secondary">Wähle zuerst eine Leistung.</p></div>
        </section>

        <section class="step is-locked" id="step-form" aria-labelledby="h3">
          <div class="step-head"><span class="step-num">3</span><h2 id="h3">Deine Daten</h2></div>
          <form class="stack-sm" id="form" novalidate>
            <div class="form-group">
              <div class="form-row"><label for="name">Name</label><input id="name" name="name" autocomplete="name" placeholder="Vor- und Nachname" required></div>
              <div class="form-row"><label for="phone">Telefon</label><input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="0151 …"></div>
              <div class="form-row"><label for="email">E-Mail</label><input id="email" name="email" type="email" autocomplete="email" placeholder="optional"></div>
              <div class="form-row tall"><label for="note">Nachricht</label><textarea id="note" name="note" rows="3" placeholder="Wunschfarbe, Haarlänge … (optional)"></textarea></div>
            </div>
            <p class="footnote secondary" style="padding: 0 var(--space-4)">Telefon oder E-Mail genügt. Dein Termin ist verbindlich, sobald der Salon ihn bestätigt.</p>
            <div id="form-error" role="alert"></div>
            <button class="btn btn-primary btn-large btn-block" type="submit" id="submit">Termin anfragen</button>
          </form>
        </section>

        <section class="step" aria-labelledby="h4" style="margin-top: var(--space-7)">
          <div class="info-grid">
            <div class="card stack-sm">
              <h3 class="title-3" id="h4">Öffnungszeiten</h3>
              <dl class="hours-list">
                ${[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const ivs = s.hours[d] || [];
                  const cls = d === todayIdx ? ' class="today"' : '';
                  return `<dt${cls}>${WEEKDAYS[d]}${d === todayIdx ? ' · heute' : ''}</dt><dd${cls}>${ivs.length ? ivs.map((iv) => `${iv.start}–${iv.end}`).join(', ') : 'geschlossen'}</dd>`;
                }).join('')}
              </dl>
            </div>
            ${s.address || s.phone ? `
            <div class="card stack-sm">
              <h3 class="title-3">So findest du uns</h3>
              ${s.address ? `<p>${esc(s.address)}</p>` : ''}
              <div class="row">
                ${s.address ? `<a class="btn btn-small" href="${maps}" target="_blank" rel="noopener">${svg(icons.pin, 16)} Route</a>` : ''}
                ${s.phone ? `<a class="btn btn-small" href="${tel}">${svg(icons.phone, 16)} ${esc(s.phone)}</a>` : ''}
              </div>
            </div>` : ''}
          </div>
        </section>
      </main>

      <aside class="summary-aside" aria-label="Deine Auswahl">
        <div class="card summary-card" id="summary"></div>
      </aside>
    </div>

    <footer class="footer">© ${new Date().getFullYear()} ${esc(s.name)}</footer>
  `;

  document.getElementById('cta').addEventListener('click', (e) => { e.preventDefault(); scrollTo(document.getElementById('step-service')); });
  document.getElementById('form').addEventListener('submit', submit);
  renderServices();
  renderSummary();
}

function renderServices() {
  const wrap = document.getElementById('services');
  const list = state.salon.services;
  if (!list.length) {
    wrap.innerHTML = '<div class="list"><p class="list-empty">Der Salon hat noch keine Leistungen eingetragen.</p></div>';
    return;
  }
  wrap.innerHTML = list.map((s) => `
    <button class="service-card" type="button" data-id="${esc(s.id)}" aria-pressed="${state.service?.id === s.id}">
      <span class="service-top">
        <span class="service-icon">${serviceIcon(s.name)}</span>
        <span class="check">${icons.check}</span>
      </span>
      <span class="stack-sm" style="gap: var(--space-1)">
        <span class="service-name">${esc(s.name)}</span>
        ${s.description ? `<span class="service-desc">${esc(s.description)}</span>` : ''}
      </span>
      <span class="service-meta">
        <span class="dur">${icons.clock} ${duration(s.duration)}</span>
        ${s.price != null ? `<span class="price">${euro(s.price)}</span>` : ''}
      </span>
    </button>`).join('');
  wrap.querySelectorAll('.service-card').forEach((btn) => btn.addEventListener('click', async () => {
    state.service = list.find((s) => s.id === btn.dataset.id);
    state.time = null;
    wrap.querySelectorAll('.service-card').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    document.getElementById('step-date').classList.remove('is-locked');
    document.getElementById('step-form').classList.add('is-locked');
    renderSummary();
    await loadDays(state.from);
    scrollTo(document.getElementById('step-date'));
  }));
}

async function loadDays(from) {
  const q = new URLSearchParams({ serviceId: state.service.id, days: WINDOW });
  if (from) q.set('from', from);
  const data = await api(`/api/salon/availability?${q}`);
  state.today = data.today;
  state.days = data.days;
  state.from = Object.keys(data.days)[0];
  if (!state.date || !(state.date in state.days) || !state.days[state.date]) {
    state.date = Object.keys(state.days).find((d) => state.days[d] > 0) || null;
  }
  renderDateBody();
  renderSummary();
  await loadTimes();
}

function shiftWindow(delta) {
  const d = new Date(`${state.from}T12:00:00`);
  d.setDate(d.getDate() + delta);
  let next = localIso(d);
  if (next < state.today) next = state.today;
  state.date = null;
  state.time = null;
  renderSummary();
  loadDays(next);
}

function renderDateBody() {
  const dates = Object.keys(state.days);
  const first = monthName(dates[0]);
  const last = monthName(dates.at(-1));
  document.getElementById('date-body').innerHTML = `
    <div class="stack-sm">
      <div class="date-bar">
        <span class="month">${first === last ? first : `${first.split(' ')[0]} – ${last}`}</span>
        <span class="row" style="gap: var(--space-2)">
          <button class="btn btn-icon btn-small" id="prev" aria-label="Frühere Tage" ${state.from <= state.today ? 'disabled' : ''}><span style="display:grid;transform:scaleX(-1)">${icons.chevron}</span></button>
          <button class="btn btn-icon btn-small" id="next" aria-label="Spätere Tage">${icons.chevron}</button>
        </span>
      </div>
      <div class="days" role="group" aria-label="Tag wählen">
        ${dates.map((d) => {
          const n = state.days[d];
          return `<button type="button" class="day" data-date="${d}" aria-pressed="${d === state.date}" ${n ? '' : 'disabled'}
            aria-label="${fmtDateLong(d)}, ${n ? `${n} freie Zeiten` : 'keine freien Zeiten'}">
            <span class="dow">${d === state.today ? 'Heute' : dow(d)}</span>
            <span class="num">${dayNum(d)}</span>
            <span class="avail">${n ? `${n} frei` : '—'}</span>
          </button>`;
        }).join('')}
      </div>
      <div id="times"></div>
    </div>`;
  document.getElementById('prev').addEventListener('click', () => shiftWindow(-WINDOW));
  document.getElementById('next').addEventListener('click', () => shiftWindow(WINDOW));
  document.querySelectorAll('.day').forEach((b) => b.addEventListener('click', () => {
    state.date = b.dataset.date;
    state.time = null;
    document.querySelectorAll('.day').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    document.getElementById('step-form').classList.add('is-locked');
    renderSummary();
    loadTimes();
  }));
}

async function loadTimes() {
  const wrap = document.getElementById('times');
  if (!state.date) {
    wrap.innerHTML = '<div class="list"><p class="list-empty">In diesem Zeitraum ist nichts mehr frei. Schau dir die nächsten Tage an.</p></div>';
    return;
  }
  const { slots } = await api(`/api/salon/slots?serviceId=${state.service.id}&date=${state.date}`);
  const groups = [
    ['Vormittag', slots.filter((t) => toMin(t) < 12 * 60)],
    ['Nachmittag', slots.filter((t) => toMin(t) >= 12 * 60 && toMin(t) < 17 * 60)],
    ['Abend', slots.filter((t) => toMin(t) >= 17 * 60)],
  ].filter(([, l]) => l.length);
  wrap.innerHTML = slots.length
    ? groups.map(([label, list]) => `
        <div class="time-group">
          <h4>${label}</h4>
          <div class="times" role="group" aria-label="${label}">
            ${list.map((t) => `<button type="button" class="time" data-time="${t}" aria-pressed="${t === state.time}">${t}</button>`).join('')}
          </div>
        </div>`).join('')
    : '<div class="list"><p class="list-empty">An diesem Tag ist nichts mehr frei.</p></div>';
  wrap.querySelectorAll('.time').forEach((b) => b.addEventListener('click', () => {
    const first = !state.time;
    state.time = b.dataset.time;
    wrap.querySelectorAll('.time').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    document.getElementById('step-form').classList.remove('is-locked');
    renderSummary();
    if (first && matchMedia('(min-width: 60rem)').matches) scrollTo(document.getElementById('step-form'));
  }));
}

function renderSummary() {
  const s = state.service;
  const el = document.getElementById('summary');
  el.innerHTML = `
    <h3 class="title-3">Deine Auswahl</h3>
    <div class="row-item">${icons.scissors}<div>${s ? `<strong>${esc(s.name)}</strong><div class="footnote secondary">${duration(s.duration)}</div>` : '<span class="placeholder">Leistung wählen</span>'}</div></div>
    <div class="row-item">${icons.calendar}<div>${state.date && s ? `<strong>${fmtDateLong(state.date)}</strong>` : '<span class="placeholder">Tag wählen</span>'}</div></div>
    <div class="row-item">${icons.clock}<div>${state.time ? `<strong>${state.time} Uhr</strong><div class="footnote secondary">bis ${endTime()} Uhr</div>` : '<span class="placeholder">Uhrzeit wählen</span>'}</div></div>
    ${s && s.price != null ? `<div class="summary-total"><span class="secondary">Preis</span><strong>${euro(s.price)}</strong></div>` : ''}
  `;
  renderMobileBar();
}

function endTime() {
  const e = toMin(state.time) + state.service.duration;
  return `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
}

// Mobil: Leiste unten mit Auswahl und nächstem Schritt
function renderMobileBar() {
  document.querySelector('.mobile-bar')?.remove();
  document.body.classList.remove('has-bar');
  if (!state.service || matchMedia('(min-width: 60rem)').matches) return;
  const ready = Boolean(state.time);
  const bar = h(`
    <div class="mobile-bar">
      <div class="info">
        <strong>${esc(state.service.name)}</strong>
        <span>${ready ? `${fmtDateShort(state.date)}, ${state.time} Uhr` : duration(state.service.duration)}${state.service.price != null ? ` · ${euro(state.service.price)}` : ''}</span>
      </div>
      <button class="btn btn-primary" type="button">${ready ? 'Weiter' : 'Uhrzeit wählen'}</button>
    </div>`);
  bar.querySelector('button').addEventListener('click', () => {
    scrollTo(document.getElementById(ready ? 'step-form' : 'step-date'));
    if (ready) setTimeout(() => document.getElementById('name').focus({ preventScroll: true }), reduceMotion() ? 0 : 400);
  });
  document.body.append(bar);
  document.body.classList.add('has-bar');
}

async function submit(e) {
  e.preventDefault();
  const f = e.target;
  const err = document.getElementById('form-error');
  const btn = document.getElementById('submit');
  err.innerHTML = '';
  if (!state.time) { toast('Bitte wähle zuerst eine Uhrzeit'); return; }
  btn.disabled = true;
  try {
    const booking = await api('/api/salon/bookings', {
      method: 'POST',
      body: {
        serviceId: state.service.id, date: state.date, time: state.time,
        name: f.name.value, phone: f.phone.value, email: f.email.value, note: f.note.value,
      },
    });
    rememberToken(booking.token);
    location.href = `/buchung/${booking.token}`;
  } catch (ex) {
    err.replaceChildren(h(`<div class="alert"><span class="dot" aria-hidden="true"></span><span>${esc(ex.message)}</span></div>`));
    btn.disabled = false;
    if (ex.status === 409) {
      state.time = null;
      document.getElementById('step-form').classList.add('is-locked');
      toast('Termin wurde gerade vergeben');
      renderSummary();
      loadDays(state.from);
    }
  }
}

// Nur beim Wechsel zwischen Handy- und Desktop-Layout neu zeichnen (nicht bei jedem Scroll-Resize auf iOS).
matchMedia('(min-width: 60rem)').addEventListener('change', () => { if (state.service) renderMobileBar(); });
init();
