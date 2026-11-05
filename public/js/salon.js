import { api, esc, euro, duration, dow, dayNum, monthName, fmtDateLong, icons, toast, h } from './common.js';

const app = document.getElementById('app');
document.getElementById('brand').insertAdjacentHTML('afterbegin', icons.scissors);

const state = { salon: null, service: null, date: null, time: null, days: {}, today: null, from: null };
const WINDOW = 14;

async function init() {
  try {
    state.salon = await api('/api/salon');
  } catch (e) {
    app.innerHTML = `<div class="alert"><span class="dot"></span>${esc(e.message)}</div>`;
    return;
  }
  const s = state.salon;
  document.title = `Termin buchen – ${s.name}`;
  document.getElementById('nav-name').textContent = s.name;
  if (s.phone) {
    const call = document.getElementById('call');
    call.href = `tel:${s.phone.replace(/[^\d+]/g, '')}`;
    call.hidden = false;
  }

  app.innerHTML = `
    <header class="stack-sm">
      <h1>${esc(s.name)}</h1>
      ${s.tagline ? `<p class="secondary title-3" style="font-weight:400">${esc(s.tagline)}</p>` : ''}
      ${s.address ? `<p class="secondary subhead">${esc(s.address)}</p>` : ''}
    </header>

    <section class="stack-sm" aria-labelledby="step1">
      <h2 id="step1"><span class="secondary">1.</span> Leistung wählen</h2>
      <div class="stack-sm" id="services"></div>
    </section>

    <section class="stack-sm" id="step-date" hidden aria-labelledby="step2">
      <div class="row spread">
        <h2 id="step2"><span class="secondary">2.</span> Tag &amp; Uhrzeit</h2>
        <div class="row" style="gap: var(--space-2)">
          <button class="btn btn-icon btn-small" id="prev" aria-label="Frühere Tage" style="transform:scaleX(-1)">${icons.chevron}</button>
          <button class="btn btn-icon btn-small" id="next" aria-label="Spätere Tage">${icons.chevron}</button>
        </div>
      </div>
      <p class="secondary subhead" id="month"></p>
      <div class="days" id="days" role="group" aria-label="Tag wählen"></div>
      <div id="times-wrap" class="stack-sm"></div>
    </section>

    <section class="stack-sm" id="step-form" hidden aria-labelledby="step3">
      <h2 id="step3"><span class="secondary">3.</span> Deine Daten</h2>
      <form class="card stack-sm" id="form" novalidate>
        <div class="alert" id="summary-line" style="background:var(--color-bg)"></div>
        <div class="field"><label for="name">Name</label><input class="input" id="name" name="name" autocomplete="name" required></div>
        <div class="form-grid">
          <div class="field"><label for="phone">Telefon</label><input class="input" id="phone" name="phone" type="tel" autocomplete="tel"></div>
          <div class="field"><label for="email">E-Mail</label><input class="input" id="email" name="email" type="email" autocomplete="email"></div>
        </div>
        <p class="hint footnote secondary">Telefon oder E-Mail genügt, damit dich der Salon erreichen kann.</p>
        <div class="field"><label for="note">Nachricht an den Salon <span class="secondary" style="font-weight:400">(optional)</span></label><textarea class="input" id="note" name="note" rows="3" placeholder="z. B. Wunschfarbe, Haarlänge …"></textarea></div>
        <div id="form-error" role="alert"></div>
        <button class="btn btn-primary btn-block" type="submit" id="submit">Termin anfragen</button>
        <p class="footnote secondary" style="text-align:center">Dein Termin ist verbindlich, sobald der Salon ihn bestätigt.</p>
      </form>
    </section>
  `;

  renderServices();
  document.getElementById('prev').addEventListener('click', () => shiftWindow(-WINDOW));
  document.getElementById('next').addEventListener('click', () => shiftWindow(WINDOW));
  document.getElementById('form').addEventListener('submit', submit);
}

function renderServices() {
  const wrap = document.getElementById('services');
  const list = state.salon.services;
  if (!list.length) {
    wrap.innerHTML = '<div class="list"><p class="list-empty">Dieser Salon hat noch keine Leistungen eingetragen.</p></div>';
    return;
  }
  wrap.innerHTML = list.map((s) => `
    <button class="choice" type="button" data-id="${esc(s.id)}" aria-pressed="${state.service?.id === s.id}">
      <span class="check">${icons.check}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font-weight:600">${esc(s.name)}</span>
        <span class="meta">${icons.clock.replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px"')} ${duration(s.duration)}${s.description ? ` · ${esc(s.description)}` : ''}</span>
      </span>
      ${s.price != null ? `<span class="price">${euro(s.price)}</span>` : ''}
    </button>`).join('');
  wrap.querySelectorAll('.choice').forEach((btn) => btn.addEventListener('click', () => {
    state.service = list.find((s) => s.id === btn.dataset.id);
    state.time = null;
    renderServices();
    document.getElementById('step-date').hidden = false;
    document.getElementById('step-form').hidden = true;
    loadDays(state.from).then(() => document.getElementById('step-date').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
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
  renderDays();
  await loadTimes();
}

function shiftWindow(delta) {
  const d = new Date(`${state.from}T12:00:00`);
  d.setDate(d.getDate() + delta);
  let next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (next < state.today) next = state.today;
  state.date = null;
  state.time = null;
  loadDays(next);
}

function renderDays() {
  const dates = Object.keys(state.days);
  document.getElementById('prev').disabled = state.from <= state.today;
  document.getElementById('month').textContent = monthName(dates[0]) === monthName(dates.at(-1))
    ? monthName(dates[0]) : `${monthName(dates[0])} – ${monthName(dates.at(-1))}`;
  const wrap = document.getElementById('days');
  wrap.innerHTML = dates.map((d) => {
    const n = state.days[d];
    return `<button type="button" class="day" data-date="${d}" aria-pressed="${d === state.date}" ${n ? '' : 'disabled'}
      aria-label="${fmtDateLong(d)}, ${n ? `${n} freie Zeiten` : 'keine freien Zeiten'}">
      <span class="dow">${d === state.today ? 'Heute' : dow(d)}</span>
      <span class="num">${dayNum(d)}</span>
      <span class="avail">${n ? `${n} frei` : '—'}</span>
    </button>`;
  }).join('');
  wrap.querySelectorAll('.day').forEach((b) => b.addEventListener('click', () => {
    state.date = b.dataset.date;
    state.time = null;
    renderDays();
    loadTimes();
  }));
}

async function loadTimes() {
  const wrap = document.getElementById('times-wrap');
  document.getElementById('step-form').hidden = !state.time;
  if (!state.date) {
    wrap.innerHTML = '<div class="list"><p class="list-empty">In diesem Zeitraum ist leider nichts mehr frei. Schau dir die nächsten Tage an.</p></div>';
    return;
  }
  const { slots } = await api(`/api/salon/slots?serviceId=${state.service.id}&date=${state.date}`);
  wrap.innerHTML = `
    <h3>${fmtDateLong(state.date)}</h3>
    ${slots.length
      ? `<div class="times" role="group" aria-label="Uhrzeit wählen">${slots.map((t) => `<button type="button" class="time" data-time="${t}" aria-pressed="${t === state.time}">${t}</button>`).join('')}</div>`
      : '<div class="list"><p class="list-empty">An diesem Tag ist nichts mehr frei.</p></div>'}
  `;
  wrap.querySelectorAll('.time').forEach((b) => b.addEventListener('click', () => {
    state.time = b.dataset.time;
    wrap.querySelectorAll('.time').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    showForm();
  }));
}

function showForm() {
  const form = document.getElementById('step-form');
  const wasHidden = form.hidden;
  form.hidden = false;
  document.getElementById('summary-line').innerHTML = `
    <span>${icons.clock.replace('<svg', '<svg width="20" height="20"')}</span>
    <span><strong>${esc(state.service.name)}</strong><br>${fmtDateLong(state.date)}, ${state.time} Uhr · ${duration(state.service.duration)}${state.service.price != null ? ` · ${euro(state.service.price)}` : ''}</span>`;
  if (wasHidden) form.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

async function submit(e) {
  e.preventDefault();
  const f = e.target;
  const err = document.getElementById('form-error');
  const btn = document.getElementById('submit');
  err.innerHTML = '';
  btn.disabled = true;
  try {
    const booking = await api(`/api/salon/bookings`, {
      method: 'POST',
      body: {
        serviceId: state.service.id,
        date: state.date,
        time: state.time,
        name: f.name.value,
        phone: f.phone.value,
        email: f.email.value,
        note: f.note.value,
      },
    });
    location.href = `/buchung/${booking.token}`;
  } catch (ex) {
    err.replaceChildren(h(`<div class="alert"><span class="dot" aria-hidden="true"></span><span>${esc(ex.message)}</span></div>`));
    btn.disabled = false;
    if (ex.status === 409) {
      state.time = null;
      toast('Termin wurde gerade vergeben');
      loadDays(state.from);
    }
  }
}

init();
