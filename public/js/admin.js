import { renderCalendar } from './calendar.js';
import { api, esc, euro, duration, fmtDateLong, fmtDateShort, icons, statusPill, toast, openSheet } from './common.js';

const app = document.getElementById('app');
document.getElementById('brand').insertAdjacentHTML('afterbegin', icons.scissors);

const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DAY_INDEX = [1, 2, 3, 4, 5, 6, 0]; // Anzeige ab Montag, Speicherung 0 = Sonntag

const state = { salon: null, bookings: [], today: null, tab: 'calendar', filter: 'upcoming' };

const errorBox = (msg) => `<div class="alert" role="alert"><span class="dot" aria-hidden="true"></span><span>${esc(msg)}</span></div>`;

// ---------------------------------------------------------------------------
// Anmeldung
// ---------------------------------------------------------------------------
function renderAuth() {
  document.getElementById('logout').hidden = true;
  document.getElementById('my-page').hidden = true;
  app.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="auth" novalidate>
        <div class="lock-icon">${icons.lock}</div>
        <div class="stack-sm">
          <h1 class="title-1" style="font: var(--text-title-1)">Salon-Bereich</h1>
          <p class="secondary">Gib dein Passwort ein, um Termine und Einstellungen zu verwalten.</p>
        </div>
        <div class="field">
          <label for="password" class="visually-hidden">Passwort</label>
          <input class="input" id="password" type="password" autocomplete="current-password" placeholder="Passwort" required autofocus>
        </div>
        <div id="auth-error"></div>
        <button class="btn btn-primary btn-large btn-block" type="submit">Anmelden</button>
      </form>
    </div>`;

  document.getElementById('auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      state.salon = await api('/api/auth/login', { method: 'POST', body: { password: f.password.value } });
      await startDashboard();
    } catch (ex) {
      document.getElementById('auth-error').innerHTML = errorBox(ex.message);
      btn.disabled = false;
      f.password.select();
    }
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
async function startDashboard() {
  const s = state.salon;
  document.getElementById('nav-name').textContent = s.name;
  const myPage = document.getElementById('my-page');
  myPage.href = '/';
  myPage.hidden = false;
  const logout = document.getElementById('logout');
  logout.hidden = false;
  logout.onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.salon = null;
    renderAuth();
  };
  await loadBookings();
  renderDashboard();
}

async function loadBookings() {
  const data = await api('/api/admin/bookings');
  state.bookings = data.bookings.filter((b) => b.kind !== 'block'); // Blocker nur im Kalender
  state.today = data.today;
}

function countConfirmed(extraDays) {
  const end = new Date(`${state.today}T12:00:00`);
  end.setDate(end.getDate() + extraDays);
  const last = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return state.bookings.filter((b) => b.status === 'confirmed' && b.date >= state.today && b.date <= last).length;
}

const pendingCount = () => state.bookings.filter((b) => b.status === 'pending' && b.date >= state.today).length;

function renderDashboard() {
  const tabs = [
    ['calendar', 'Kalender'],
    ['requests', 'Anfragen'],
    ['services', 'Leistungen'],
    ['hours', 'Öffnungszeiten'],
    ['settings', 'Einstellungen'],
  ];
  const n = pendingCount();
  app.innerHTML = `
    <div class="stack">
      <div class="stack-sm">
        <h1>${esc(state.salon.name)}</h1>
        <p class="secondary subhead">Buchungsseite für deine Kunden: <a href="/" target="_blank" rel="noopener" style="font-weight:600">${esc(location.host)}</a></p>
      </div>
      <div class="stats">
        <div class="card compact stat"><span class="value">${n}</span><span class="label">Offene Anfragen</span></div>
        <div class="card compact stat"><span class="value">${countConfirmed(0)}</span><span class="label">Termine heute</span></div>
        <div class="card compact stat"><span class="value">${countConfirmed(6)}</span><span class="label">Nächste 7 Tage</span></div>
      </div>
      <div class="segmented" role="tablist" aria-label="Bereiche">
        ${tabs.map(([id, label]) => `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${label}${id === 'requests' && n ? ` <span class="badge" aria-label="${n} offene Anfragen">${n}</span>` : ''}</button>`).join('')}
      </div>
      <div id="panel" role="tabpanel"></div>
    </div>`;
  app.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    renderDashboard();
  }));
  ({ calendar: renderCalendarTab, requests: renderRequests, services: renderServices, hours: renderHours, settings: renderSettings })[state.tab]();
}

function renderCalendarTab() {
  renderCalendar(document.getElementById('panel'), {
    salon: state.salon,
    today: state.today,
    onStatus: (id, status) => changeStatus(id, status),
    onChanged: async () => {
      await loadBookings();
      updateStats();
    },
  });
}

// Kennzahlen und Badge aktualisieren, ohne den Kalender neu aufzubauen
function updateStats() {
  const values = document.querySelectorAll('.stats .value');
  if (values.length === 3) {
    values[0].textContent = pendingCount();
    values[1].textContent = countConfirmed(0);
    values[2].textContent = countConfirmed(6);
  }
  const tab = document.querySelector('[data-tab=requests]');
  if (tab) {
    const n = pendingCount();
    tab.innerHTML = `Anfragen${n ? ` <span class="badge" aria-label="${n} offene Anfragen">${n}</span>` : ''}`;
  }
}

// ---------- Termine ----------
function renderRequests() {
  const panel = document.getElementById('panel');
  const pending = state.bookings.filter((b) => b.status === 'pending' && b.date >= state.today);
  const filters = {
    upcoming: ['Bevorstehend', (b) => b.status === 'confirmed' && b.date >= state.today],
    past: ['Vergangen', (b) => b.status === 'confirmed' && b.date < state.today],
    closed: ['Abgelehnt & storniert', (b) => b.status === 'declined' || b.status === 'cancelled'],
  };
  let other = state.bookings.filter(filters[state.filter][1]);
  if (state.filter !== 'upcoming') other = other.reverse();

  panel.innerHTML = `
    <div class="stack">
      <section>
        <h2 class="section-title">Offene Anfragen (${pending.length})</h2>
        <div class="list" id="pending">${pending.length ? pending.map(bookingRow).join('') : '<p class="list-empty">Keine offenen Anfragen. 🎉</p>'}</div>
      </section>
      <section class="stack-sm">
        <div class="segmented" role="tablist" aria-label="Termine filtern">
          ${Object.entries(filters).map(([id, [label]]) => `<button role="tab" data-filter="${id}" aria-selected="${state.filter === id}">${label}</button>`).join('')}
        </div>
        <div class="list">${other.length ? groupByDay(other) : '<p class="list-empty">Keine Termine.</p>'}</div>
      </section>
    </div>`;

  panel.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    renderRequests();
  }));
  panel.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => changeStatus(b.dataset.id, b.dataset.action)));
}

function groupByDay(list) {
  let current = '';
  return list.map((b) => {
    const header = b.date !== current ? `<div class="list-item" style="background:var(--color-bg)"><strong class="subhead">${b.date === state.today ? 'Heute' : fmtDateLong(b.date)}</strong></div>` : '';
    current = b.date;
    return header + bookingRow(b);
  }).join('');
}

function bookingRow(b) {
  const c = b.customer;
  const actions = b.status === 'pending'
    ? `<button class="btn btn-primary btn-small" data-action="confirmed" data-id="${b.id}">${icons.check.replace('<svg', '<svg width="16" height="16"')} Bestätigen</button>
       <button class="btn btn-small" data-action="declined" data-id="${b.id}">Ablehnen</button>`
    : b.status === 'confirmed' && b.date >= state.today
      ? `<button class="btn btn-small" data-action="cancelled" data-id="${b.id}">Absagen</button>`
      : '';
  return `
    <div class="list-item">
      <div class="booking grow">
        <div class="when">
          <div class="t">${b.start}</div>
          <div class="caption secondary">bis ${b.end}</div>
          ${b.status === 'pending' ? `<div class="caption secondary">${fmtDateShort(b.date)}</div>` : ''}
        </div>
        <div style="min-width:0">
          <div style="font-weight:600">${esc(c.name)}</div>
          <div class="subhead secondary">${esc(b.service.name)} · ${duration(b.service.duration)}${b.service.price != null ? ` · ${euro(b.service.price)}` : ''}</div>
          <div class="subhead">
            ${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>` : ''}
            ${c.phone && c.email ? ' · ' : ''}
            ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}
          </div>
          ${c.note ? `<p class="subhead secondary" style="margin-top:var(--space-1)">„${esc(c.note)}“</p>` : ''}
        </div>
        <div>${statusPill(b.status)}</div>
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>
    </div>`;
}

function changeStatus(id, status) {
  const b = state.bookings.find((x) => x.id === id);
  const titles = { confirmed: 'Termin bestätigen', declined: 'Anfrage ablehnen', cancelled: 'Termin absagen' };
  const placeholders = {
    confirmed: 'z. B. Bis Dienstag! Bitte 5 Minuten früher da sein.',
    declined: 'z. B. Leider ausgebucht – wie wäre 15 Uhr?',
    cancelled: 'z. B. Wegen Krankheit müssen wir leider absagen.',
  };
  const sheet = openSheet(`
    <form class="stack-sm" id="status-form">
      <h2>${titles[status]}</h2>
      <p class="secondary">${esc(b.customer.name)} · ${esc(b.service.name)}<br>${fmtDateLong(b.date)}, ${b.start} Uhr</p>
      <div class="field"><label for="msg">Nachricht an den Kunden <span class="secondary" style="font-weight:400">(optional)</span></label>
        <textarea class="input" id="msg" rows="3" placeholder="${placeholders[status]}"></textarea>
        <span class="hint">Der Kunde sieht die Nachricht auf seiner Buchungsseite.</span></div>
      <div id="status-error"></div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn" id="abort">Abbrechen</button>
        <button type="submit" class="btn btn-primary">${titles[status].split(' ')[1].replace(/^./, (c) => c.toUpperCase())}</button>
      </div>
    </form>`, { label: titles[status] });
  sheet.querySelector('#abort').addEventListener('click', sheet.close);
  sheet.querySelector('#status-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/admin/bookings/${id}/status`, { method: 'POST', body: { status, message: sheet.querySelector('#msg').value } });
      sheet.close();
      await loadBookings();
      renderDashboard();
      toast({ confirmed: 'Termin bestätigt', declined: 'Anfrage abgelehnt', cancelled: 'Termin abgesagt' }[status]);
    } catch (ex) {
      sheet.querySelector('#status-error').innerHTML = errorBox(ex.message);
    }
  });
}

// ---------- Leistungen ----------
function renderServices() {
  const panel = document.getElementById('panel');
  const list = state.salon.services;
  panel.innerHTML = `
    <div class="stack-sm">
      <div class="row spread">
        <p class="secondary subhead" style="flex:1;min-width:14rem">Lege fest, was Kunden buchen können und wie lange es dauert. Die Dauer bestimmt, wie viel Zeit im Kalender blockiert wird.</p>
        <button class="btn btn-primary" id="add">${icons.plus.replace('<svg', '<svg width="18" height="18"')} Leistung</button>
      </div>
      <div class="list">
        ${list.length ? list.map((s) => `
          <div class="list-item">
            <div class="grow">
              <div style="font-weight:600">${esc(s.name)} ${s.active ? '' : '<span class="status" style="margin-left:var(--space-2)">Ausgeblendet</span>'}</div>
              <div class="subhead secondary">${duration(s.duration)}${s.price != null ? ` · ${euro(s.price)}` : ''}${s.description ? ` · ${esc(s.description)}` : ''}</div>
            </div>
            <button class="btn btn-small" data-edit="${s.id}">Bearbeiten</button>
          </div>`).join('') : '<p class="list-empty">Noch keine Leistungen. Lege z. B. „Herrenhaarschnitt – 30 Min.“ oder „Färben – 90 Min.“ an.</p>'}
      </div>
    </div>`;
  panel.querySelector('#add').addEventListener('click', () => editService());
  panel.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editService(list.find((s) => s.id === b.dataset.edit))));
}

const DURATION_PRESETS = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180];

function editService(service) {
  const isNew = !service;
  const s = service || { name: '', duration: 30, price: '', description: '', active: true };
  const sheet = openSheet(`
    <form class="stack-sm" id="svc-form">
      <h2>${isNew ? 'Neue Leistung' : 'Leistung bearbeiten'}</h2>
      <div class="field"><label for="svc-name">Name</label><input class="input" id="svc-name" value="${esc(s.name)}" required placeholder="z. B. Färben"></div>
      <div class="field">
        <label for="svc-duration">Dauer</label>
        <div class="row" style="gap:var(--space-2)">
          <input class="input" id="svc-duration" type="number" min="5" max="600" step="5" value="${s.duration}" style="width:7rem" required>
          <span class="secondary">Minuten</span>
          <span class="secondary subhead" id="svc-duration-text">= ${duration(s.duration)}</span>
        </div>
        <div class="row" style="gap:var(--space-2);margin-top:var(--space-2)">
          ${DURATION_PRESETS.map((m) => `<button type="button" class="btn btn-small" data-min="${m}">${duration(m)}</button>`).join('')}
        </div>
      </div>
      <div class="field"><label for="svc-price">Preis in € <span class="secondary" style="font-weight:400">(optional)</span></label><input class="input" id="svc-price" type="number" min="0" step="0.5" value="${s.price ?? ''}" style="width:9rem"></div>
      <div class="field"><label for="svc-desc">Beschreibung <span class="secondary" style="font-weight:400">(optional)</span></label><input class="input" id="svc-desc" value="${esc(s.description)}" placeholder="z. B. inkl. Waschen und Föhnen"></div>
      <div class="row spread">
        <label for="svc-active" class="label">Online buchbar</label>
        <label class="switch"><input type="checkbox" id="svc-active" ${s.active ? 'checked' : ''} aria-label="Online buchbar"><span class="track"></span></label>
      </div>
      <div id="svc-error"></div>
      <div class="row spread">
        ${isNew ? '<span></span>' : `<button type="button" class="btn" id="svc-delete"><span class="dot" style="background:var(--color-red)" aria-hidden="true"></span>Löschen</button>`}
        <div class="row">
          <button type="button" class="btn" id="svc-cancel">Abbrechen</button>
          <button type="submit" class="btn btn-primary">Sichern</button>
        </div>
      </div>
    </form>`, { label: 'Leistung' });

  const dur = sheet.querySelector('#svc-duration');
  const durText = sheet.querySelector('#svc-duration-text');
  const syncDur = () => { durText.textContent = Number(dur.value) > 0 ? `= ${duration(Number(dur.value))}` : ''; };
  dur.addEventListener('input', syncDur);
  sheet.querySelectorAll('[data-min]').forEach((b) => b.addEventListener('click', () => { dur.value = b.dataset.min; syncDur(); }));
  sheet.querySelector('#svc-cancel').addEventListener('click', sheet.close);
  sheet.querySelector('#svc-delete')?.addEventListener('click', async () => {
    if (!confirm(`„${s.name}“ wirklich löschen? Bestehende Termine bleiben erhalten.`)) return;
    state.salon = await api(`/api/admin/services/${service.id}`, { method: 'DELETE' });
    sheet.close();
    renderDashboard();
    toast('Leistung gelöscht');
  });
  sheet.querySelector('#svc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: sheet.querySelector('#svc-name').value,
      duration: Number(dur.value),
      price: sheet.querySelector('#svc-price').value,
      description: sheet.querySelector('#svc-desc').value,
      active: sheet.querySelector('#svc-active').checked,
    };
    try {
      state.salon = await api(isNew ? '/api/admin/services' : `/api/admin/services/${service.id}`, { method: isNew ? 'POST' : 'PUT', body });
      sheet.close();
      renderDashboard();
      toast(isNew ? 'Leistung angelegt' : 'Gesichert');
    } catch (ex) {
      sheet.querySelector('#svc-error').innerHTML = errorBox(ex.message);
    }
  });
}

// ---------- Öffnungszeiten & Schließtage ----------
function renderHours() {
  const panel = document.getElementById('panel');
  const hours = structuredClone(state.salon.hours);
  let closed = structuredClone(state.salon.closedDates || []);

  const intervalHtml = (d, iv, i) => `
    <div class="interval">
      <input class="input" type="time" step="300" value="${iv.start}" data-d="${d}" data-i="${i}" data-k="start" aria-label="${DAYS[DAY_INDEX.indexOf(d)]} von">
      <span class="secondary">bis</span>
      <input class="input" type="time" step="300" value="${iv.end}" data-d="${d}" data-i="${i}" data-k="end" aria-label="${DAYS[DAY_INDEX.indexOf(d)]} bis">
      <button type="button" class="btn btn-icon btn-small" data-remove="${d}:${i}" aria-label="Zeitraum entfernen">${icons.trash}</button>
    </div>`;

  function draw() {
    panel.innerHTML = `
      <div class="stack">
        <section class="stack-sm">
          <p class="secondary subhead">Lege für jeden Tag fest, wann gebucht werden kann. Mit mehreren Zeiträumen trägst du Pausen ein (z. B. 9–12 und 13–18 Uhr).</p>
          <div class="list">
            ${DAY_INDEX.map((d, idx) => {
              const list = hours[d] || [];
              return `
              <div class="list-item">
                <div class="hours-day grow">
                  <div class="row" style="gap:var(--space-2)">
                    <label class="switch"><input type="checkbox" data-toggle="${d}" ${list.length ? 'checked' : ''} aria-label="${DAYS[idx]} geöffnet"><span class="track"></span></label>
                    <strong>${DAYS[idx]}</strong>
                  </div>
                  <div class="intervals">
                    ${list.length ? list.map((iv, i) => intervalHtml(d, iv, i)).join('') : '<span class="secondary" style="line-height:var(--tap-min)">Geschlossen</span>'}
                    ${list.length ? `<div><button type="button" class="link-btn subhead" data-add="${d}">+ Zeitraum / Pause</button></div>` : ''}
                  </div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </section>

        <section class="stack-sm">
          <h2>Urlaub &amp; Schließtage</h2>
          <p class="secondary subhead">An diesen Tagen ist keine Online-Buchung möglich.</p>
          <div class="list">
            ${closed.length ? closed.map((c, i) => `
              <div class="list-item">
                <div class="grow"><strong>${fmtDateLong(c.date)}</strong>${c.reason ? `<div class="subhead secondary">${esc(c.reason)}</div>` : ''}</div>
                <button type="button" class="btn btn-icon btn-small" data-unclose="${i}" aria-label="Schließtag entfernen">${icons.trash}</button>
              </div>`).join('') : '<p class="list-empty">Keine Schließtage eingetragen.</p>'}
            <div class="list-item">
              <div class="form-grid grow" style="align-items:end">
                <div class="field"><label for="cd-from">Von</label><input class="input" type="date" id="cd-from" min="${state.today}"></div>
                <div class="field"><label for="cd-to">Bis <span class="secondary" style="font-weight:400">(optional)</span></label><input class="input" type="date" id="cd-to" min="${state.today}"></div>
                <div class="field"><label for="cd-reason">Grund <span class="secondary" style="font-weight:400">(optional)</span></label><input class="input" id="cd-reason" placeholder="z. B. Urlaub"></div>
                <button type="button" class="btn btn-small" id="cd-add">Hinzufügen</button>
              </div>
            </div>
          </div>
        </section>

        <div id="hours-error"></div>
        <div><button class="btn btn-primary" id="save-hours">Öffnungszeiten sichern</button></div>
      </div>`;

    panel.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('change', () => {
      const d = el.dataset.toggle;
      hours[d] = el.checked ? [{ start: '09:00', end: '18:00' }] : [];
      draw();
    }));
    panel.querySelectorAll('input[data-k]').forEach((el) => el.addEventListener('change', () => {
      hours[el.dataset.d][el.dataset.i][el.dataset.k] = el.value;
    }));
    panel.querySelectorAll('[data-add]').forEach((el) => el.addEventListener('click', () => {
      const list = hours[el.dataset.add];
      const last = list.at(-1);
      list.push({ start: last ? last.end : '09:00', end: '18:00' });
      draw();
    }));
    panel.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', () => {
      const [d, i] = el.dataset.remove.split(':');
      hours[d].splice(Number(i), 1);
      draw();
    }));
    panel.querySelectorAll('[data-unclose]').forEach((el) => el.addEventListener('click', () => {
      closed.splice(Number(el.dataset.unclose), 1);
      draw();
    }));
    panel.querySelector('#cd-add').addEventListener('click', () => {
      const from = panel.querySelector('#cd-from').value;
      const to = panel.querySelector('#cd-to').value || from;
      const reason = panel.querySelector('#cd-reason').value;
      if (!from || to < from) { toast('Bitte ein gültiges Datum wählen'); return; }
      const d = new Date(`${from}T12:00:00`);
      for (let n = 0; n < 366; n += 1) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (iso > to) break;
        if (!closed.some((c) => c.date === iso)) closed.push({ date: iso, reason });
        d.setDate(d.getDate() + 1);
      }
      closed.sort((a, b) => a.date.localeCompare(b.date));
      draw();
    });
    panel.querySelector('#save-hours').addEventListener('click', async () => {
      try {
        await api('/api/admin/hours', { method: 'PUT', body: { hours } });
        state.salon = await api('/api/admin/closed-dates', { method: 'PUT', body: { closedDates: closed } });
        closed = structuredClone(state.salon.closedDates);
        toast('Öffnungszeiten gesichert');
        draw();
      } catch (ex) {
        panel.querySelector('#hours-error').innerHTML = errorBox(ex.message);
      }
    });
  }
  draw();
}

// ---------- Einstellungen ----------
function renderSettings() {
  const s = state.salon;
  const panel = document.getElementById('panel');
  const opt = (values, current, fmt) => values.map((v) => `<option value="${v}" ${v === current ? 'selected' : ''}>${fmt(v)}</option>`).join('');
  panel.innerHTML = `
    <form class="stack" id="settings">
      <section class="card stack-sm">
        <h2>Salon</h2>
        <div class="field"><label for="st-name">Name</label><input class="input" id="st-name" value="${esc(s.name)}" required></div>
        <div class="field"><label for="st-tagline">Kurzbeschreibung</label><input class="input" id="st-tagline" value="${esc(s.tagline)}" placeholder="z. B. Dein Friseur im Kiez"></div>
        <div class="form-grid">
          <div class="field"><label for="st-address">Adresse</label><input class="input" id="st-address" value="${esc(s.address)}"></div>
          <div class="field"><label for="st-phone">Telefon</label><input class="input" id="st-phone" type="tel" value="${esc(s.phone)}"></div>
        </div>
      </section>

      <section class="card stack-sm">
        <h2>Buchungsregeln</h2>
        <div class="form-grid">
          <div class="field">
            <label for="st-step">Zeitraster</label>
            <select class="input" id="st-step">${opt([5, 10, 15, 20, 30, 45, 60], s.slotStep, (v) => `alle ${v} Minuten`)}</select>
            <span class="hint">In diesen Abständen werden Startzeiten angeboten.</span>
          </div>
          <div class="field">
            <label for="st-capacity">Plätze gleichzeitig</label>
            <select class="input" id="st-capacity">${opt([1, 2, 3, 4, 5, 6, 8, 10], s.capacity, (v) => (v === 1 ? '1 Platz' : `${v} Plätze`))}</select>
            <span class="hint">Wie viele Kunden ihr zur selben Zeit bedienen könnt.</span>
          </div>
          <div class="field">
            <label for="st-lead">Vorlaufzeit</label>
            <select class="input" id="st-lead">${opt([0, 30, 60, 120, 240, 720, 1440, 2880], s.minLeadMinutes, (v) => (v === 0 ? 'keine' : v < 60 ? `${v} Minuten` : v < 1440 ? `${v / 60} Std.` : `${v / 1440} ${v === 1440 ? 'Tag' : 'Tage'}`))}</select>
            <span class="hint">So früh vorher muss mindestens gebucht werden.</span>
          </div>
          <div class="field">
            <label for="st-horizon">Buchbar im Voraus</label>
            <select class="input" id="st-horizon">${opt([7, 14, 30, 60, 90, 180, 365], s.horizonDays, (v) => `${v} Tage`)}</select>
          </div>
        </div>
      </section>

      <div id="settings-error"></div>
      <div><button class="btn btn-primary" type="submit">Einstellungen sichern</button></div>
    </form>`;

  panel.querySelector('#settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => panel.querySelector(id).value;
    try {
      state.salon = await api('/api/admin/salon', {
        method: 'PUT',
        body: {
          name: v('#st-name'), tagline: v('#st-tagline'), address: v('#st-address'), phone: v('#st-phone'),
          slotStep: Number(v('#st-step')), capacity: Number(v('#st-capacity')),
          minLeadMinutes: Number(v('#st-lead')), horizonDays: Number(v('#st-horizon')),
        },
      });
      document.getElementById('nav-name').textContent = state.salon.name;
      renderDashboard();
      toast('Einstellungen gesichert');
    } catch (ex) {
      panel.querySelector('#settings-error').innerHTML = errorBox(ex.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
(async () => {
  try {
    state.salon = await api('/api/admin/me');
    await startDashboard();
  } catch {
    renderAuth();
  }
})();

// Neue Anfragen regelmäßig nachladen (nur Kalender/Anfragen, nicht während ein Dialog offen ist).
setInterval(async () => {
  if (!state.salon || document.hidden || document.querySelector('.sheet') || !['requests', 'calendar'].includes(state.tab)) return;
  const before = state.bookings.map((b) => b.id + b.status).join();
  const pendingBefore = pendingCount();
  try {
    await loadBookings();
    if (pendingCount() > pendingBefore) toast('Neue Terminanfrage');
    if (state.bookings.map((b) => b.id + b.status).join() !== before) renderDashboard();
  } catch { /* still */ }
}, 30000);

