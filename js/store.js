// localStorage persistence. Two keys: the whole data file, and the in-progress session.

const DATA_KEY = 'gymlog.data';
const ACTIVE_KEY = 'gymlog.activeSession';

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

// Best-effort eviction resistance (iOS 17+); GitHub backup is the durability layer.
export function requestPersist() {
  navigator.storage?.persist?.().catch(() => {});
}
