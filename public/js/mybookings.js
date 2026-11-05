// Merkt sich gebuchte Termine auf diesem Gerät (nur die geheimen Buchungs-Links, keine persönlichen Daten).
const KEY = 'meine-termine';

export function savedTokens() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function store(list) {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set(list)].slice(-30))); } catch { /* privater Modus */ }
}

export const rememberToken = (token) => store([...savedTokens(), token]);
export const forgetToken = (token) => store(savedTokens().filter((t) => t !== token));
