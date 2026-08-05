// Daily-pushup derivations and data-shape migration. Pure — no DOM, no storage.
//
// A pushup day holds the manual counts entered through the day; the day total
// rolls up every pushup done that date: manual entries, warm-up easy pushups,
// and gym push-up sets. Days flagged `legacy` were imported from the raw notes,
// whose counts already mixed gym numbers in — they display exactly as noted,
// with no roll-up on top.

// Parked history from data/daily-pushups.json (wayfinder ticket 08), seeded by
// migrate() so the page starts with the real streak.
const LEGACY_DAYS = [
  { date: '2026-06-08', sets: [6, 6, 4] },
  { date: '2026-06-09', sets: [7, 7, 10, 12, 10, 10] },
  { date: '2026-07-07', sets: [10, 7, 10, 12, 12, 10] },
  { date: '2026-07-08', sets: [8] },
  { date: '2026-07-09', sets: [10, 8, 8, 13, 12, 12, 12] },
  { date: '2026-07-13', sets: [14, 10] },
  { date: '2026-07-15', sets: [13, 13] },
];

// The full pushup picture for one date, or null if nothing happened.
// { manual, gym, total } — gym is warm-up easy pushups then push-up set reps.
export function pushupDay(data, iso) {
  const entry = (data.pushupDays ?? []).find(d => d.date === iso);
  const manual = entry ? [...entry.sets] : [];
  let gym = [];
  if (!entry?.legacy) {
    const s = data.sessions.find(x => x.date === iso);
    if (s) {
      if (s.warmup?.pushups > 0) gym.push(s.warmup.pushups);
      const pu = s.entries.find(e => e.exercise === 'push-up');
      if (pu) gym.push(...pu.sets.map(x => x.reps).filter(r => r > 0));
    }
  }
  if (!manual.length && !gym.length) return null;
  return { date: iso, manual, gym, total: [...manual, ...gym].reduce((a, b) => a + b, 0) };
}

export function addPushups(data, iso, n) {
  let entry = data.pushupDays.find(d => d.date === iso);
  if (!entry) {
    entry = { date: iso, sets: [] };
    data.pushupDays.push(entry);
    data.pushupDays.sort((a, b) => a.date.localeCompare(b.date));
  }
  entry.sets.push(n);
  return entry;
}

// The last n days with any pushups at all (manual or gym), newest first.
export function recentPushupDays(data, n = 14) {
  const dates = new Set([
    ...(data.pushupDays ?? []).map(d => d.date),
    ...data.sessions.map(s => s.date),
  ]);
  return [...dates].sort().reverse()
    .map(iso => pushupDay(data, iso))
    .filter(Boolean)
    .slice(0, n);
}

// Upgrade a loaded data file in place to the current shape. Idempotent — runs
// on every boot, restore, and pull.
export function migrate(data) {
  if (!data.pushupDays) {
    data.pushupDays = LEGACY_DAYS.map(d => ({ ...d, sets: [...d.sets], legacy: true }));
  }
  return data;
}
