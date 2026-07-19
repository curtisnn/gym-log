// localStorage persistence. Four keys: the whole data file, the in-progress session,
// the GitHub PAT, and the sync state (last-written blob sha + dirty flag).

const DATA_KEY = 'gymlog.data';
const ACTIVE_KEY = 'gymlog.activeSession';
const TOKEN_KEY = 'gymlog.token';
const SYNC_KEY = 'gymlog.sync';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadData() { return read(DATA_KEY); }
export function saveData(data) { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }

export function loadActive() { return read(ACTIVE_KEY); }
export function saveActive(active) { localStorage.setItem(ACTIVE_KEY, JSON.stringify(active)); }
export function clearActive() { localStorage.removeItem(ACTIVE_KEY); }

export function loadToken() { return localStorage.getItem(TOKEN_KEY); }
export function saveToken(token) { localStorage.setItem(TOKEN_KEY, token); }

export function loadSyncState() { return read(SYNC_KEY) ?? { sha: null, dirty: false }; }
export function saveSyncState(state) { localStorage.setItem(SYNC_KEY, JSON.stringify(state)); }

// Best-effort eviction resistance (iOS 17+); GitHub backup is the durability layer.
export function requestPersist() {
  navigator.storage?.persist?.().catch(() => {});
}
