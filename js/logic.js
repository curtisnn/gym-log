// Pure session/model logic. No DOM, no storage — testable under node.
// Data shapes per the pinned model: data = { exercises, template, rules, sessions }.

export const SETTING_KEYS = ['assistLbs', 'barHeight', 'variant'];

export const LABELS = {
  'bar-low': 'bar (low)', 'ground': 'ground', 'diamond': 'diamond',
  'squat': 'squat', 'split-squat': 'split squat',
  'knees-bent': 'knees bent', 'straight': 'straight',
  'at-9': 'bar at 9', 'above-9': 'bar above 9', 'above-8': 'bar above 8', 'below-8': 'bar below 8',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseData(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
  if (!d || !Array.isArray(d.exercises) || !d.template?.sections || !Array.isArray(d.sessions)) {
    throw new Error('JSON is missing exercises / template.sections / sessions.');
  }
  return d;
}

export function exerciseById(data, id) {
  return data.exercises.find(e => e.id === id);
}

export function templateItems(data) {
  return data.template.sections.flatMap(sec => sec.items.map(item => ({ section: sec, item })));
}

export function lastAppearance(sessions, exId) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const entry = sessions[i].entries.find(e => e.exercise === exId);
    if (entry) return { date: sessions[i].date, entry };
  }
  return null;
}

// Exercises seen in the last `horizon` sessions — the sheet shows this union,
// so one rushed session that skips the finisher doesn't erase it.
export function recentExerciseIds(sessions, horizon = 3) {
  const ids = new Set();
  for (const s of sessions.slice(-horizon)) for (const e of s.entries) ids.add(e.exercise);
  return ids;
}

// Each exercise pre-fills from its own last appearance (values + settings),
// not from the last session wholesale.
export function prefillEntry(data, exId) {
  const last = lastAppearance(data.sessions, exId);
  if (last) {
    return { exercise: exId, sets: last.entry.sets.map(s => ({ ...s, done: false })) };
  }
  const ex = exerciseById(data, exId);
  const t = templateItems(data).find(x => x.item.exercise === exId);
  const base = { [ex.metric]: t?.item.targetRange?.[0] ?? 0 };
  if (ex.variants) base.variant = ex.variants[0];
  if (ex.tracks === 'barHeight') base.barHeight = ex.barHeights[0];
  if (ex.tracks === 'assistLbs') base.assistLbs = 0;
  return {
    exercise: exId,
    sets: Array.from({ length: t?.item.targetSets ?? 3 }, () => ({ ...base, done: false })),
  };
}

export function prefillSession(data, todayIso) {
  const recent = recentExerciseIds(data.sessions);
  const entries = templateItems(data)
    .filter(({ item }) => recent.has(item.exercise))
    .map(({ item }) => prefillEntry(data, item.exercise));
  const lastWarmup = data.sessions.at(-1)?.warmup;
  return {
    date: todayIso,
    warmup: { stretches: false, pushups: lastWarmup?.pushups ?? 8, done: false },
    entries,
  };
}

export function value(ex, set) {
  return set[ex.metric] ?? 0;
}

export function adjustValue(ex, set, delta) {
  set[ex.metric] = Math.max(0, value(ex, set) + delta);
}

export function settingLabel(ex, set) {
  if (ex.tracks === 'assistLbs') return set.assistLbs + ' lb';
  if (ex.tracks === 'barHeight') return LABELS[set.barHeight] ?? set.barHeight;
  if (ex.variants) return LABELS[set.variant] ?? set.variant;
  return null;
}

// Walk the exercise's progression axis: dir -1 = easier, +1 = harder.
// Assist weight and bar height descend as they get harder; variants ascend.
export function stepSetting(ex, set, dir) {
  if (ex.tracks === 'assistLbs') {
    set.assistLbs = Math.max(0, set.assistLbs - dir * 5);
  } else if (ex.tracks === 'barHeight') {
    const ladder = ex.barHeights;
    const i = Math.min(ladder.length - 1, Math.max(0, ladder.indexOf(set.barHeight) + dir));
    set.barHeight = ladder[i];
  } else if (ex.variants) {
    const ladder = ex.variants;
    const i = Math.min(ladder.length - 1, Math.max(0, ladder.indexOf(set.variant) + dir));
    set.variant = ladder[i];
    if (set.variant === 'split-squat') set.perLeg = true;
    else delete set.perLeg;
  }
}

// A setting change carries forward to the exercise's remaining undone sets.
export function carryForward(entry, fromIndex) {
  const src = entry.sets[fromIndex];
  for (let j = fromIndex + 1; j < entry.sets.length; j++) {
    const s = entry.sets[j];
    if (s.done) continue;
    for (const key of SETTING_KEYS) {
      if (key in src) s[key] = src[key];
    }
    if (src.perLeg) s.perLeg = true;
    else delete s.perLeg;
  }
}

export function doneCount(active) {
  return active.entries.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0);
}

// Only confirmed (✓) sets are recorded; entries with none are dropped.
// Returns null when nothing was done.
export function finishSession(active) {
  const entries = active.entries
    .map(e => ({
      exercise: e.exercise,
      sets: e.sets.filter(s => s.done).map(({ done, ...set }) => set),
    }))
    .filter(e => e.sets.length > 0);
  if (entries.length === 0) return null;
  return {
    date: active.date,
    warmup: { stretches: active.warmup.stretches, pushups: active.warmup.pushups },
    entries,
  };
}

// Last n appearances of an exercise, oldest first.
export function historyFor(data, exId, n = 3) {
  const rows = [];
  for (let i = data.sessions.length - 1; i >= 0 && rows.length < n; i--) {
    const entry = data.sessions[i].entries.find(e => e.exercise === exId);
    if (entry) rows.push({ date: data.sessions[i].date, entry });
  }
  return rows.reverse();
}

export function addableExercises(data, active) {
  const onSheet = new Set(active.entries.map(e => e.exercise));
  return data.exercises.filter(ex => !onSheet.has(ex.id));
}

// Insert the entry where the template says the exercise belongs;
// exercises outside the template go last.
export function addExercise(data, active, exId) {
  const entry = prefillEntry(data, exId);
  const order = templateItems(data).map(({ item }) => item.exercise);
  const idx = order.indexOf(exId);
  let insertAt = active.entries.length;
  if (idx !== -1) {
    const after = active.entries.findIndex(e => {
      const o = order.indexOf(e.exercise);
      return o === -1 || o > idx;
    });
    if (after !== -1) insertAt = after;
  }
  active.entries.splice(insertAt, 0, entry);
  return entry;
}

// Group active entries under their template sections, preserving entry order.
export function groupEntries(data, active) {
  const sectionOf = new Map();
  for (const sec of data.template.sections) {
    for (const it of sec.items) sectionOf.set(it.exercise, sec);
  }
  const groups = [];
  active.entries.forEach((entry, ei) => {
    const sec = sectionOf.get(entry.exercise);
    const name = sec?.name ?? 'Extra';
    let g = groups.at(-1);
    if (!g || g.name !== name) {
      g = { name, restSeconds: sec?.restSeconds ?? null, rows: [] };
      groups.push(g);
    }
    g.rows.push({ ei, entry });
  });
  return groups;
}

export function targetHint(data, exId) {
  const t = templateItems(data).find(x => x.item.exercise === exId);
  if (!t?.item.targetRange) return '';
  const [lo, hi] = t.item.targetRange;
  const unit = exerciseById(data, exId).metric === 'seconds' ? 's' : '';
  return lo === hi ? `${lo}${unit}` : `${lo}–${hi}${unit}`;
}

export function formatDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
