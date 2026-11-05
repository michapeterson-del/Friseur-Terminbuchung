// Kalender im Friseur-Bereich: Monatsübersicht + Tagesansicht mit Zeitleiste (wie Apple Kalender)
import { api, esc, euro, duration, fmtDateLong, icons, statusPill, toast, openSheet, WEEKDAYS } from './common.js';

const HOUR_REM = 4; // Höhe einer Stunde in der Zeitleiste
const WEEK = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const asDate = (s) => new Date(`${s}T12:00:00`);
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const errorBox = (msg) => `<div class="alert" role="alert"><span class="dot" aria-hidden="true"></span><span>${esc(msg)}</span></div>`;

const cal = { month: null, selected: null, days: {}, day: null };

/**
 * @param {HTMLElement} panel
 * @param {{ salon: object, today: string, onStatus: (id: string, status: string) => void, onChanged: () => Promise<void> }} ctx
 */
export async function renderCalendar(panel, ctx) {
  cal.ctx = ctx;
  cal.panel = panel;
  if (!cal.selected) cal.selected = ctx.today;
  if (!cal.month) cal.month = `${cal.selected.slice(0, 7)}-01`;
  panel.innerHTML = `
    <div class="cal-layout">
      <section class="card cal-month" aria-label="Monatsübersicht"></section>
      <section class="card cal-day" aria-label="Tagesansicht"></section>
    </div>`;
  await Promise.all([loadMonth(), loadDay()]);
}

// ---------------------------------------------------------------- Monat
async function loadMonth() {
  const first = asDate(cal.month);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // Montag der ersten Woche
  const data = await api(`/api/admin/calendar?from=${iso(start)}&days=42`);
  cal.days = data.days;
  cal.gridStart = iso(start);
  drawMonth();
}

function drawMonth() {
  const el = cal.panel.querySelector('.cal-month');
  const month = asDate(cal.month);
  const label = month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const dates = Object.keys(cal.days);
  el.innerHTML = `
    <div class="cal-head">
      <h2 class="title-3">${label}</h2>
      <div class="row" style="gap: var(--space-2)">
        <button class="btn btn-icon btn-small" data-nav="-1" aria-label="Vorheriger Monat"><span style="display:grid;transform:scaleX(-1)">${icons.chevron}</span></button>
        <button class="btn btn-small" data-nav="0">Heute</button>
        <button class="btn btn-icon btn-small" data-nav="1" aria-label="Nächster Monat">${icons.chevron}</button>
      </div>
    </div>
    <div class="cal-grid" role="grid">
      ${WEEK.map((d) => `<div class="cal-wd" role="columnheader">${d}</div>`).join('')}
      ${dates.map((d) => {
        const s = cal.days[d];
        const inMonth = d.slice(0, 7) === cal.month.slice(0, 7);
        const total = s.confirmed + s.pending;
        const cls = ['cal-cell', inMonth ? '' : 'out', d === cal.ctx.today ? 'today' : '', d === cal.selected ? 'selected' : '', s.open ? '' : 'closed', d < cal.ctx.today ? 'past' : ''].join(' ');
        const aria = `${fmtDateLong(d)}: ${s.open ? `${total} Termine${s.pending ? `, ${s.pending} offen` : ''}${s.full ? ', ausgebucht' : ''}` : 'geschlossen'}`;
        return `<button class="${cls}" data-date="${d}" aria-label="${aria}" aria-pressed="${d === cal.selected}">
          <span class="cal-num">${asDate(d).getDate()}</span>
          <span class="cal-info">
            ${s.open || total ? `${total ? `<span class="cal-count">${total}</span>` : ''}${s.pending ? `<span class="cal-pending" title="offene Anfragen">${s.pending}</span>` : ''}` : ''}
            ${s.full ? '<span class="cal-full">voll</span>' : ''}
          </span>
          ${s.open ? `<span class="cal-load" aria-hidden="true"><span style="width:${Math.round(s.load * 100)}%"></span></span>` : ''}
        </button>`;
      }).join('')}
    </div>
    <div class="cal-legend footnote secondary">
      <span><span class="cal-count">2</span> Termine</span>
      <span><span class="cal-pending">1</span> offene Anfrage</span>
      <span><span class="cal-load inline"><span style="width:60%"></span></span> Auslastung</span>
    </div>`;
  el.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const step = Number(b.dataset.nav);
    if (step === 0) {
      cal.selected = cal.ctx.today;
      cal.month = `${cal.ctx.today.slice(0, 7)}-01`;
      loadDay();
    } else {
      const m = asDate(cal.month);
      m.setMonth(m.getMonth() + step, 1);
      cal.month = iso(m);
    }
    loadMonth();
  }));
  el.querySelectorAll('.cal-cell').forEach((b) => b.addEventListener('click', () => {
    cal.selected = b.dataset.date;
    if (b.dataset.date.slice(0, 7) !== cal.month.slice(0, 7)) {
      cal.month = `${b.dataset.date.slice(0, 7)}-01`;
      loadMonth();
    } else {
      el.querySelectorAll('.cal-cell').forEach((x) => {
        x.classList.toggle('selected', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
    }
    loadDay().then(() => {
      if (!matchMedia('(min-width: 60rem)').matches) cal.panel.querySelector('.cal-day').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });
  }));
}

// ---------------------------------------------------------------- Tag
async function loadDay() {
  cal.day = await api(`/api/admin/day?date=${cal.selected}`);
  drawDay();
}

function drawDay() {
  const el = cal.panel.querySelector('.cal-day');
  const d = cal.day;
  const active = d.bookings.filter((b) => b.status === 'pending' || b.status === 'confirmed');
  const inactive = d.bookings.filter((b) => b.kind === 'appointment' && (b.status === 'declined' || b.status === 'cancelled'));
  const appts = active.filter((b) => b.kind === 'appointment');
  const pending = appts.filter((b) => b.status === 'pending').length;
  const isToday = d.date === d.today;
  const date = asDate(d.date);

  // Sichtbarer Zeitraum: Öffnungszeiten und alle Termine, auf volle Stunden gerundet
  const mins = [...d.hours.flatMap((iv) => [toMin(iv.start), toMin(iv.end)]), ...active.flatMap((b) => [toMin(b.start), toMin(b.end)])];
  let from = mins.length ? Math.floor(Math.min(...mins) / 60) * 60 : 8 * 60;
  let to = mins.length ? Math.ceil(Math.max(...mins) / 60) * 60 : 19 * 60;
  if (to - from < 4 * 60) to = Math.min(24 * 60, from + 4 * 60);
  if (from > 0 && to - from < 4 * 60) from = Math.max(0, to - 4 * 60);
  const y = (min) => ((min - from) / 60) * HOUR_REM;

  // Spalten für überlappende Termine (wie Apple Kalender nebeneinander)
  const sorted = [...active].sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end));
  let cluster = [];
  let clusterEnd = -1;
  const lanesEnd = [];
  const flush = () => { const n = Math.max(...cluster.map((c) => c.lane)) + 1; cluster.forEach((c) => { c.cols = n; }); cluster = []; lanesEnd.length = 0; };
  const placed = sorted.map((b) => {
    const s = toMin(b.start);
    const e = toMin(b.end);
    if (cluster.length && s >= clusterEnd) flush();
    let lane = lanesEnd.findIndex((end) => end <= s);
    if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(e); } else lanesEnd[lane] = e;
    const item = { b, s, e, lane, cols: 1 };
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, e);
    return item;
  });
  if (cluster.length) flush();

  const hours = [];
  for (let m = from; m <= to; m += 60) hours.push(m);

  el.innerHTML = `
    <div class="cal-head">
      <div>
        <p class="eyebrow">${isToday ? 'Heute' : WEEKDAYS[date.getDay()]}</p>
        <h2 class="title-2">${date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}</h2>
      </div>
      <div class="row" style="gap: var(--space-2)">
        <button class="btn btn-small" id="add-block">Blocken</button>
        <button class="btn btn-primary btn-small" id="add-appt">${icons.plus.replace('<svg', '<svg width="16" height="16"')} Termin</button>
      </div>
    </div>
    <div class="chips" style="margin: 0">
      ${d.stats.open
        ? `<span class="status">${appts.length} ${appts.length === 1 ? 'Termin' : 'Termine'}</span>
           ${pending ? `<span class="status status-pending"><span class="dot" aria-hidden="true"></span>${pending} offen</span>` : ''}
           <span class="status">Auslastung ${Math.round(d.stats.load * 100)} %</span>
           ${d.stats.full ? '<span class="status status-declined"><span class="dot" aria-hidden="true"></span>Ausgebucht</span>' : ''}`
        : `<span class="status status-declined"><span class="dot" aria-hidden="true"></span>${d.closedReason !== null ? `Geschlossen${d.closedReason ? ` – ${esc(d.closedReason)}` : ''}` : 'Ruhetag'}</span>`}
    </div>
    <div class="timeline" style="height:${y(to)}rem" id="timeline" aria-label="Zeitleiste">
      ${d.hours.map((iv) => `<div class="tl-open" style="top:${y(toMin(iv.start))}rem;height:${y(toMin(iv.end)) - y(toMin(iv.start))}rem"></div>`).join('')}
      ${hours.map((m) => `<div class="tl-hour" style="top:${y(m)}rem"><span>${hhmm(m)}</span></div>`).join('')}
      ${isToday && d.nowMinutes >= from && d.nowMinutes <= to ? `<div class="tl-now" style="top:${y(d.nowMinutes)}rem" aria-label="Jetzt ${hhmm(d.nowMinutes)}"></div>` : ''}
      <div class="tl-events">
        ${placed.map(({ b, s, e, lane, cols }) => {
          const h = y(e) - y(s);
          const short = e - s <= 30;
          const title = b.kind === 'block' ? esc(b.service.name) : esc(b.customer.name);
          return `<button class="tl-event ${b.kind === 'block' ? 'block' : b.status} ${short ? 'short' : ''}" data-id="${b.id}"
            style="top:${y(s)}rem;height:calc(${h}rem - 2px);left:calc(${(lane / cols) * 100}% + 2px);width:calc(${100 / cols}% - 4px)"
            aria-label="${b.start} bis ${b.end}: ${title}${b.kind === 'appointment' ? `, ${esc(b.service.name)}` : ''}${b.status === 'pending' ? ', Anfrage offen' : ''}">
            <span class="tl-time">${b.start}${short ? '' : ` – ${b.end}`}</span>
            <span class="tl-title">${b.status === 'pending' && !short ? '<span class="tl-tag">Anfrage</span> ' : ''}${title}</span>
            ${short || b.kind === 'block' ? '' : `<span class="tl-sub">${esc(b.service.name)}</span>`}
          </button>`;
        }).join('')}
      </div>
    </div>
    ${inactive.length ? `
      <details class="footnote secondary">
        <summary style="cursor:pointer;min-height:var(--tap-min);display:flex;align-items:center">Abgelehnt oder storniert (${inactive.length})</summary>
        <div class="list">${inactive.map((b) => `<div class="list-item"><span class="grow">${b.start} · ${esc(b.customer.name)} · ${esc(b.service.name)}</span>${statusPill(b.status)}</div>`).join('')}</div>
      </details>` : ''}
    <p class="footnote secondary">Tipp: In eine freie Stelle der Zeitleiste tippen, um dort einen Termin einzutragen.</p>
  `;

  el.querySelector('#add-appt').addEventListener('click', () => newEntry('appointment'));
  el.querySelector('#add-block').addEventListener('click', () => newEntry('block'));
  el.querySelectorAll('.tl-event').forEach((btn) => btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    showEvent(d.bookings.find((b) => b.id === btn.dataset.id));
  }));
  el.querySelector('#timeline').addEventListener('click', (ev) => {
    if (ev.target.closest('.tl-event')) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const minute = from + ((ev.clientY - rect.top) / remPx / HOUR_REM) * 60;
    const step = cal.ctx.salon.slotStep || 15;
    newEntry('appointment', hhmm(Math.max(from, Math.min(to - step, Math.floor(minute / step) * step))));
  });
}

async function refresh() {
  await Promise.all([loadMonth(), loadDay(), cal.ctx.onChanged()]);
}

// ---------------------------------------------------------------- Details
function showEvent(b) {
  if (!b) return;
  const c = b.customer;
  const isBlock = b.kind === 'block';
  const sheet = openSheet(`
    <div class="stack-sm">
      <div class="row spread">
        <p class="eyebrow">${fmtDateLong(b.date)}</p>
        ${isBlock ? '<span class="status">Geblockt</span>' : statusPill(b.status)}
      </div>
      <h2>${isBlock ? esc(b.service.name) : esc(c.name)}</h2>
      <p class="title-3" style="font-variant-numeric: tabular-nums">${b.start} – ${b.end} Uhr</p>
      ${isBlock ? '' : `
      <div class="list">
        <div class="list-item"><span class="grow secondary">Leistung</span><strong>${esc(b.service.name)} · ${duration(b.service.duration)}</strong></div>
        ${b.service.price != null ? `<div class="list-item"><span class="grow secondary">Preis</span><strong>${euro(b.service.price)}</strong></div>` : ''}
        ${c.phone ? `<div class="list-item"><span class="grow secondary">Telefon</span><a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}"><strong>${esc(c.phone)}</strong></a></div>` : ''}
        ${c.email ? `<div class="list-item"><span class="grow secondary">E-Mail</span><a href="mailto:${esc(c.email)}"><strong>${esc(c.email)}</strong></a></div>` : ''}
      </div>`}
      ${c.note ? `<div class="card compact" style="box-shadow:none;background:var(--color-bg)"><p class="eyebrow">Notiz</p><p>${esc(c.note)}</p></div>` : ''}
      <div class="row" style="justify-content:flex-end; margin-top: var(--space-3)">
        <button class="btn" data-close>Schließen</button>
        ${isBlock ? '<button class="btn" data-act="delete"><span class="dot" style="background:var(--color-red)" aria-hidden="true"></span>Löschen</button>' : ''}
        ${!isBlock && b.status === 'pending' ? '<button class="btn" data-act="declined">Ablehnen</button><button class="btn btn-primary" data-act="confirmed">Bestätigen</button>' : ''}
        ${!isBlock && b.status === 'confirmed' && b.date >= cal.day.today ? '<button class="btn" data-act="cancelled">Absagen</button>' : ''}
      </div>
    </div>`, { label: 'Termin' });
  sheet.querySelector('[data-close]').addEventListener('click', sheet.close);
  sheet.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    if (act === 'delete') {
      await api(`/api/admin/bookings/${b.id}`, { method: 'DELETE' });
      sheet.close();
      toast('Blocker gelöscht');
      refresh();
      return;
    }
    sheet.close();
    cal.ctx.onStatus(b.id, act);
  }));
}

// ---------------------------------------------------------------- Neu eintragen
function newEntry(kind, time) {
  const s = cal.ctx.salon;
  const services = s.services.filter((x) => x.active);
  const firstOpen = (cal.day.hours[0] && cal.day.hours[0].start) || '09:00';
  const sheet = openSheet(`
    <form class="stack-sm" id="entry-form">
      <h2>Eintragen</h2>
      <div class="segmented" role="tablist" aria-label="Art">
        <button type="button" role="tab" data-kind="appointment" aria-selected="${kind === 'appointment'}">Kundentermin</button>
        <button type="button" role="tab" data-kind="block" aria-selected="${kind === 'block'}">Zeit blocken</button>
      </div>
      <div class="form-grid">
        <div class="field"><label for="e-date">Datum</label><input class="input" type="date" id="e-date" value="${cal.selected}" required></div>
        <div class="field"><label for="e-time">Uhrzeit</label><input class="input" type="time" id="e-time" step="300" value="${time || firstOpen}" required></div>
      </div>
      <div data-for="appointment" class="stack-sm">
        <div class="field"><label for="e-service">Leistung</label>
          <select class="input" id="e-service">${services.map((x) => `<option value="${x.id}">${esc(x.name)} · ${duration(x.duration)}</option>`).join('')}</select></div>
        <div class="field"><label for="e-name">Name</label><input class="input" id="e-name" placeholder="z. B. Herr Meier"></div>
        <div class="field"><label for="e-phone">Telefon <span class="secondary" style="font-weight:400">(optional)</span></label><input class="input" id="e-phone" type="tel"></div>
        <div class="field"><label for="e-note">Notiz <span class="secondary" style="font-weight:400">(optional)</span></label><input class="input" id="e-note"></div>
      </div>
      <div data-for="block" class="stack-sm">
        <div class="field"><label for="e-title">Grund</label><input class="input" id="e-title" placeholder="z. B. Mittagspause, Arzttermin" list="block-reasons">
          <datalist id="block-reasons"><option value="Mittagspause"><option value="Pause"><option value="Privat"><option value="Fortbildung"></datalist></div>
        <div class="field"><label for="e-duration">Dauer</label>
          <select class="input" id="e-duration">${[15, 30, 45, 60, 90, 120, 180, 240, 480].map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${duration(m)}</option>`).join('')}</select></div>
        <p class="footnote secondary">In geblockten Zeiten können Kunden nicht online buchen.</p>
      </div>
      <div id="entry-error"></div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn" data-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">Eintragen</button>
      </div>
    </form>`, { label: 'Eintragen' });

  let current = kind;
  const sync = () => {
    sheet.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.kind === current)));
    sheet.querySelectorAll('[data-for]').forEach((x) => { x.hidden = x.dataset.for !== current; });
  };
  sync();
  sheet.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { current = b.dataset.kind; sync(); }));
  sheet.querySelector('[data-close]').addEventListener('click', sheet.close);

  const send = async (force) => {
    const v = (sel) => sheet.querySelector(sel).value;
    const body = current === 'block'
      ? { kind: 'block', date: v('#e-date'), time: v('#e-time'), duration: Number(v('#e-duration')), title: v('#e-title'), force }
      : { kind: 'appointment', date: v('#e-date'), time: v('#e-time'), serviceId: v('#e-service'), name: v('#e-name'), phone: v('#e-phone'), note: v('#e-note'), force };
    return api('/api/admin/bookings', { method: 'POST', body });
  };

  sheet.querySelector('#entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = sheet.querySelector('#entry-error');
    err.innerHTML = '';
    try {
      try {
        await send(false);
      } catch (ex) {
        if (ex.status !== 409 || !confirm(`${ex.message} Trotzdem eintragen?`)) throw ex;
        await send(true);
      }
      cal.selected = sheet.querySelector('#e-date').value;
      cal.month = `${cal.selected.slice(0, 7)}-01`;
      sheet.close();
      toast(current === 'block' ? 'Zeit geblockt' : 'Termin eingetragen');
      refresh();
    } catch (ex) {
      err.innerHTML = errorBox(ex.message);
    }
  });
}

export function resetCalendar() {
  cal.month = null;
  cal.selected = null;
}
