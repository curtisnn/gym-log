import * as L from './logic.js';
import * as T from './trends.js';
import * as R from './rules.js';
import * as H from './habits.js';
import * as store from './store.js';
import * as sync from './sync.js';

let data = store.loadData();
if (data && !data.pushupDays) {
  H.migrate(data);
  store.saveData(data);
  store.saveSyncState({ ...store.loadSyncState(), dirty: true });
}
let active = store.loadActive();

// Transient UI state — never persisted.
const ui = {
  sel: null,          // { ei, si } | { wu: true } | null — cell the editor bar targets
  sheet: null,        // { kind: 'history', ex } | { kind: 'add' } | null
  confirmFinish: false,
  confirmCancel: false,
  justFinished: null, // set count of the session just saved, shown once on home
  error: null,        // setup restore error
  busy: false,        // a network call is in flight (setup restore)
  sync: null,         // { state: 'working'|'error'|'auth'|'diverged', msg?, remote? }
  trendsOpen: null,   // id of the expanded trends card
  calBack: 0,         // how many 5-week windows the History calendar is paged back
  dayOpen: null,      // iso date whose read-only detail sheet is open
  journey: false,     // all-time journey view expanded
  pushN: 10,          // count staged in the Habits quick-add
};

const $app = document.getElementById('app');

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtVal(ex, set) {
  const unit = ex.metric === 'seconds' ? 's' : '×';
  return `${L.value(ex, set)}<small>${unit}${set.perLeg ? ' /leg' : ''}</small>`;
}

/* ---------- views ---------- */

function renderSetup() {
  return `<div class="page">
    <h1>Gym Log</h1>
    <p class="lead">No data on this device yet. Paste the GitHub token (in 1Password)
    to pull your history from the private data repo.</p>
    ${ui.error ? `<p class="error">${esc(ui.error)}</p>` : ''}
    <input type="password" id="token-input" placeholder="github_pat_…" autocomplete="off">
    <button class="primary" data-act="restore" ${ui.busy ? 'disabled' : ''}>
      ${ui.busy ? 'Pulling…' : 'Restore from GitHub'}</button>
  </div>`;
}

function renderSyncStatus() {
  const s = ui.sync;
  if (s?.state === 'working') return `<p class="syncline dim">Backing up…</p>`;
  if (s?.state === 'auth') {
    return `<div class="syncbox">
      <p class="error">GitHub rejected the token. Paste a fresh one (1Password) — your
      sessions are safe on the phone meanwhile.</p>
      <input type="password" id="token-input" placeholder="github_pat_…" autocomplete="off">
      <button class="ghost" data-act="save-token">Save token &amp; retry</button>
    </div>`;
  }
  if (s?.state === 'diverged') {
    return `<div class="syncbox">
      <p class="error">The GitHub copy has changed since this phone last backed up.</p>
      <button class="ghost" data-act="overwrite">Overwrite GitHub with phone data</button>
      <button class="ghost" data-act="pull">Pull GitHub copy (replaces phone data)</button>
    </div>`;
  }
  const err = s?.state === 'error' ? `<p class="error">${esc(s.msg)}</p>` : '';
  if (store.loadSyncState().dirty) {
    return `${err}<p class="syncline"><span class="warn">Not backed up</span>
      <button data-act="retry">Retry</button></p>`;
  }
  return `<p class="syncline dim">Backed up ✓</p>`;
}

function renderHome() {
  const last = data.sessions.at(-1);
  return `<div class="page">
    <h1>Gym Log</h1>
    ${ui.justFinished !== null ? `<p class="saved">Session saved ✓ — ${ui.justFinished} set${ui.justFinished === 1 ? '' : 's'}</p>` : ''}
    <p class="lead">${last
      ? `${data.sessions.length} sessions logged · last ${L.formatDate(last.date)}`
      : 'No sessions yet'}</p>
    ${renderSyncStatus()}
    <button class="primary" data-act="start">Start session</button>
    <p class="foot"><a href="#trends">History &amp; Trends</a> · <a href="#habits">Habits</a> · <a href="#rules">Rules</a></p>
  </div>`;
}

// The Habits page: two hardcoded daily practices, not a generic engine.
// Today: the pushup day-log (issue #16). The 90/90/1 vote joins with #17.
function renderHabits() {
  const today = todayIso();
  const day = H.pushupDay(data, today);
  const recent = H.recentPushupDays(data, 14).filter(d => d.date !== today);
  return `<div class="page habits">
    <div class="topbar"><button data-act="back">‹ Back</button><h1>Habits</h1><span></span></div>
    <div class="card">
      <h2>Pushups today</h2>
      <div class="putotal">${day ? day.total : 0}<small> total</small></div>
      ${day ? `<p class="pusets">${day.manual.join(' · ')}${day.manual.length && day.gym.length ? ' · ' : ''}${day.gym.length ? `<span class="dim">${day.gym.join(' · ')} (gym)</span>` : ''}</p>` : ''}
      <div class="puadd">
        <button class="stepbtn" data-act="pu-adj" data-d="-1">−</button>
        <div class="val">${ui.pushN}</div>
        <button class="stepbtn" data-act="pu-adj" data-d="1">+</button>
        <button class="primary slim" data-act="pu-add">Add ${ui.pushN}</button>
      </div>
    </div>
    <div class="card">
      <h2>Days</h2>
      ${recent.length ? `<table class="pudays">${recent.map(d =>
        `<tr><td class="d">${L.formatDate(d.date)}</td>
         <td class="s">${d.manual.join(' · ')}${d.manual.length && d.gym.length ? ' · ' : ''}${d.gym.length ? `<span class="dim">${d.gym.join(' · ')}</span>` : ''}</td>
         <td class="t">${d.total}</td></tr>`).join('')}</table>`
        : '<p class="none">no pushup days yet</p>'}
    </div>
  </div>`;
}

function renderRules() {
  return `<div class="page rulespage">
    <div class="topbar"><button data-act="back">‹ Back</button><h1>Rules</h1><span></span></div>
    ${R.rulesHtml(data?.rules)}
  </div>`;
}

// Variant D of the trends decision: dot calendar, two heroes, expandable cards.
function renderTrends() {
  let h = `<div class="page trends">
    <div class="topbar"><button data-act="back">‹ Back</button><h1>Trends</h1><span></span></div>`;
  if (!data.sessions.length) {
    return h + '<p class="lead">No sessions yet — trends appear after your first workout.</p></div>';
  }

  const span = T.dateSpan(data);
  const heroChart = { color: '#fff', h: 120, gridColor: 'rgba(255,255,255,.3)', textColor: 'rgba(255,255,255,.75)' };

  const cal = T.calendarWindow(data, todayIso(), ui.calBack);
  h += `<div class="card"><div class="calhd">
      <button data-act="cal-back" ${cal.canBack ? '' : 'disabled'} aria-label="earlier">‹</button>
      <h2>${cal.label}</h2>
      <button data-act="cal-fwd" ${cal.canForward ? '' : 'disabled'} aria-label="later">›</button></div>
    <div class="cal5">
      ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span class="dow">${d}</span>`).join('')}
      ${cal.weeks.flat().map(d => d.mark
        ? `<button class="cd ${d.mark === 'session' ? 'on' : 'pu'} ${d.today ? 'today' : ''}" data-act="day-open" data-iso="${d.iso}">${d.n}</button>`
        : `<span class="cd ${d.today ? 'today' : ''} ${d.future ? 'future' : ''}">${d.n}</span>`).join('')}
    </div>
    <button class="journeylink" data-act="journey">${ui.journey ? 'hide the journey' : 'the whole journey ↓'}</button>
    ${ui.journey ? `<div class="months">${T.calendarMonths(data, todayIso()).map(mo =>
      `<div class="month"><div class="mn">${mo.label}</div><div class="days">${'<span></span>'.repeat(mo.lead)}${mo.days.map(d =>
        `<span class="d ${d.on ? 'on' : ''}">${d.n}</span>`).join('')}</div></div>`).join('')}</div>` : ''}
  </div>`;

  const assist = T.assistSeries(data);
  if (assist.length) {
    const a0 = assist[0], a1 = assist.at(-1);
    h += `<div class="hero pull"><div class="k">Road to a pull-up</div>
      <div class="big">${a1.y}<small> lbs assist</small></div>
      <div class="delta">${a0.y > a1.y ? `▼ ${a0.y - a1.y} lbs since ${T.shortDate(a0.date)} · ` : ''}goal 0</div>
      ${T.lineChart(assist, span, { ...heroChart, invert: true, min: 0 })}</div>`;
  }

  const pushVol = T.pushVolumeSeries(data);
  if (pushVol.length) {
    const marks = T.variantMarks(pushVol);
    const p1 = pushVol.at(-1);
    const variant = L.LABELS[p1.variant] ?? p1.variant ?? '';
    let delta;
    if (marks.length) {
      const m = marks.at(-1);
      const since = pushVol.filter(p => T.day(p.date) >= T.day(m.date)).map(p => p.y);
      delta = `${since.join(' → ')} since ${m.label} (${T.shortDate(m.date)})`;
    } else {
      const d = p1.y - pushVol[0].y;
      delta = `${d < 0 ? '▼' : '▲'} ${Math.abs(d)} reps since ${T.shortDate(pushVol[0].date)}`;
    }
    h += `<div class="hero push"><div class="k">Push-up volume</div>
      <div class="big">${p1.y}<small> reps${variant ? ' · ' + esc(variant) : ''}</small></div>
      <div class="delta">${esc(delta)}</div>
      ${T.lineChart(pushVol, span, { ...heroChart, marks })}</div>`;
  }

  const cards = [];
  const hang = T.hangSeries(data);
  if (hang.length) {
    cards.push({ id: 'hang', k: 'Dead hang', v: `${hang.at(-1).y}<small> s best</small>`,
      pts: hang, color: '#a78bfa', opts: {} });
  }
  const row = T.rowLevelSeries(data);
  const ladder = L.exerciseById(data, 'inverted-row')?.barHeights ?? [];
  if (row.length && ladder.length) {
    const cur = row.at(-1).y;
    cards.push({ id: 'row', k: 'Inverted row',
      v: `Lvl ${cur}<small> / ${ladder.length} (${esc(L.LABELS[ladder[cur - 1]] ?? ladder[cur - 1])})</small>`,
      pts: row, color: '#34d399', opts: { min: 1, max: ladder.length },
      note: ladder.map(x => L.LABELS[x] ?? x).join(' → ') + ' (harder)' });
  }
  if (cards.length) {
    h += `<div class="grid2">${cards.map(c => {
      const open = ui.trendsOpen === c.id;
      return `<button class="stat ${open ? 'open' : ''}" data-act="trend-open" data-id="${c.id}">
        <div class="k">${c.k}</div><div class="v">${c.v}</div>
        ${open ? T.lineChart(c.pts, span, { color: c.color, ...c.opts }) : T.sparkline(c.pts, span, c.color)}
        ${open && c.note ? `<div class="note">${esc(c.note)}</div>` : ''}</button>`;
    }).join('')}</div>`;
  }
  return h + '</div>' + renderDaySheet();
}

// Read-only view of a saved day, opened from the History calendar: the session
// paper grid (if there was one) plus the day's pushup roll-up.
function renderDaySheet() {
  if (!ui.dayOpen) return '';
  const s = L.sessionOn(data, ui.dayOpen);
  const pu = H.pushupDay(data, ui.dayOpen);
  if (!s && !pu) return '';
  let inner = `<div class="hd"><b>${L.formatDate(ui.dayOpen)}</b>
    <button data-act="day-close" aria-label="close">✕</button></div>`;
  if (pu) {
    inner += `<p class="pusum"><b>${pu.total}</b> pushups
      <small>${[...pu.manual, ...pu.gym].join(' · ')}${pu.gym.length ? ' (incl. gym)' : ''}</small></p>`;
  }
  if (!s) return `<div class="overlay" data-act="day-close"></div><div class="sheet">${inner}</div>`;
  inner += `<table class="grid ro">
    <tr class="sechead"><td colspan="5">Warm-up</td></tr>
    <tr><td class="exname"><span class="nm">Warm-up</span></td>
      <td class="cell"><span class="rocell">${s.warmup?.stretches ? '✓' : '—'}<br><small>stretch</small></span></td>
      <td class="cell"><span class="rocell">${s.warmup?.pushups ?? 0}×<br><small>push-up</small></span></td>
      <td class="cell"></td><td class="setg"></td></tr>`;
  for (const group of L.groupEntries(data, s)) {
    inner += `<tr class="sechead"><td colspan="5">${esc(group.name)}</td></tr>`;
    for (const { entry } of group.rows) {
      const ex = L.exerciseById(data, entry.exercise);
      const label0 = L.settingLabel(ex, entry.sets[0]);
      inner += `<tr><td class="exname"><span class="nm">${esc(ex.name)}</span></td>`;
      for (let si = 0; si < 3; si++) {
        const set = entry.sets[si];
        inner += `<td class="cell">${set ? `<span class="rocell">${fmtVal(ex, set)}</span>` : ''}</td>`;
      }
      inner += `<td class="setg">${label0 ? `<span>${esc(label0)}</span>` : ''}</td></tr>`;
    }
  }
  inner += '</table>';
  return `<div class="overlay" data-act="day-close"></div><div class="sheet">${inner}</div>`;
}

function renderLogging() {
  const w = active.warmup;
  let h = `<div class="topbar">
      <div><h1>Today</h1><span class="date">${L.formatDate(active.date)}</span></div>
      <a href="#rules" class="ruleslink">Rules</a>
    </div>
    <table class="grid"><tr><th>Exercise</th><th>Set 1</th><th>Set 2</th><th>Set 3</th><th></th></tr>
    <tr class="sechead"><td colspan="5">Warm-up</td></tr>
    <tr><td class="exname"><span class="nm">Warm-up</span><small>stretch + easy push-ups</small></td>
      <td class="cell"><button data-act="wu-stretch" class="${w.stretches ? 'done' : ''}">${w.stretches ? '✓' : '—'}<br><small>stretch</small></button></td>
      <td class="cell"><button data-act="sel-wu" class="${ui.sel?.wu ? 'sel' : ''} ${w.done ? 'done' : ''}">${w.pushups}×<br><small>push-up</small></button></td>
      <td class="cell"></td><td class="setg"></td></tr>`;

  for (const group of L.groupEntries(data, active)) {
    h += `<tr class="sechead"><td colspan="5">${esc(group.name)}${group.restSeconds ? ` · rest ${group.restSeconds}s` : ''}</td></tr>`;
    for (const { ei, entry } of group.rows) {
      const ex = L.exerciseById(data, entry.exercise);
      const label0 = L.settingLabel(ex, entry.sets[0]);
      h += `<tr><td class="exname"><button data-act="hist" data-ex="${entry.exercise}">
        <span class="nm">${esc(ex.name)}</span><span class="hicon">▂▄▆</span><small>${L.targetHint(data, entry.exercise)}</small></button></td>`;
      for (let si = 0; si < 3; si++) {
        const s = entry.sets[si];
        h += `<td class="cell">${s ? `<button data-act="sel" data-e="${ei}" data-s="${si}"
          class="${ui.sel && !ui.sel.wu && ui.sel.ei === ei && ui.sel.si === si ? 'sel' : ''} ${s.done ? 'done' : ''}">${fmtVal(ex, s)}</button>` : ''}</td>`;
      }
      h += `<td class="setg">${label0 ? `<button data-act="sel" data-e="${ei}" data-s="0">${esc(label0)}</button>` : ''}</td></tr>`;
    }
  }
  h += `</table>
    <div class="actions">
      <button class="ghost" data-act="add-open">+ Add exercise</button>
      ${L.doneCount(active) > 0
        ? `<button class="primary ${ui.confirmFinish ? 'confirm' : ''}" data-act="finish">
            ${ui.confirmFinish ? 'Tap again to save' : 'Finish session'}</button>`
        : `<button class="primary" disabled>Finish session</button>`}
    </div>
    <div class="actions">
      <button class="ghost ${ui.confirmCancel ? 'confirm-cancel' : ''}" data-act="cancel">
        ${ui.confirmCancel ? 'Tap again to discard' : 'Cancel session'}</button>
    </div>`;
  return h + renderEditor() + renderSheet();
}

function renderEditor() {
  if (!ui.sel) return '';
  if (ui.sel.wu) {
    const w = active.warmup;
    return `<div class="editor"><div class="who"><b>Warm-up push-ups</b></div><div class="controls">
      <button class="stepbtn" data-act="wu-adj" data-d="-1">−</button>
      <div class="val">${w.pushups}</div>
      <button class="stepbtn" data-act="wu-adj" data-d="1">+</button>
      <button class="donebtn ${w.done ? 'on' : ''}" data-act="wu-done">✓</button></div></div>`;
  }
  const { ei, si } = ui.sel;
  const entry = active.entries[ei];
  const ex = L.exerciseById(data, entry.exercise);
  const set = entry.sets[si];
  const label = L.settingLabel(ex, set);
  let h = `<div class="editor"><div class="who"><b>${esc(ex.name)}</b> · set ${si + 1}</div>
    <div class="controls">
      <button class="stepbtn" data-act="adj" data-d="-1">−</button>
      <div class="val">${fmtVal(ex, set)}</div>
      <button class="stepbtn" data-act="adj" data-d="1">+</button>
      <button class="donebtn ${set.done ? 'on' : ''}" data-act="done">✓</button></div>`;
  if (label) {
    h += `<div class="axisrow">
      <button data-act="axis" data-d="-1">‹ easier</button>
      <span class="lbl">${esc(label)}</span>
      <button data-act="axis" data-d="1">harder ›</button></div>`;
  }
  return h + '</div>';
}

function renderSheet() {
  if (!ui.sheet) return '';
  let inner;
  if (ui.sheet.kind === 'history') {
    const ex = L.exerciseById(data, ui.sheet.ex);
    const unit = ex.metric === 'seconds' ? 's' : '×';
    const rows = L.historyFor(data, ui.sheet.ex);
    inner = `<div class="hd"><b>${esc(ex.name)} — last 3</b><button data-act="sheet-close" aria-label="close">✕</button></div><table>`;
    for (const r of rows) {
      const settings = [...new Set(r.entry.sets.map(s => L.settingLabel(ex, s)).filter(Boolean))].join(' → ');
      const vals = r.entry.sets.map(s => L.value(ex, s) ?? '—').join(' / ');
      inner += `<tr><td class="d">${L.formatDate(r.date)}</td><td class="s">${esc(settings)}</td>
        <td class="v">${vals ? vals + unit : '—'}</td></tr>`;
    }
    inner += '</table>';
    if (rows.length < 3) inner += `<p class="none">no earlier entries — that’s fine</p>`;
  } else {
    const options = L.addableExercises(data, active);
    inner = `<div class="hd"><b>Add exercise</b><button data-act="sheet-close" aria-label="close">✕</button></div>`;
    inner += options.length
      ? options.map(ex => `<button class="addrow" data-act="add" data-ex="${ex.id}">${esc(ex.name)}</button>`).join('')
      : '<p class="none">the whole catalog is already on the sheet</p>';
  }
  return `<div class="overlay" data-act="sheet-close"></div><div class="sheet">${inner}</div>`;
}

function render() {
  let view;
  if (location.hash === '#rules' && data) view = renderRules();
  else if (location.hash === '#habits' && data) view = renderHabits();
  else if (location.hash === '#trends' && data) view = renderTrends();
  else if (!data) view = renderSetup();
  else if (active) view = renderLogging();
  else view = renderHome();
  const y = window.scrollY;
  $app.innerHTML = view;
  window.scrollTo(0, y);
}

/* ---------- actions ---------- */

function selectedSet() {
  const entry = active.entries[ui.sel.ei];
  return { entry, ex: L.exerciseById(data, entry.exercise), set: entry.sets[ui.sel.si] };
}

// Auto-backup on session finish, and the manual retry. Foreground only — no
// background sync exists on iOS, so this runs while the app is open.
async function doBackup() {
  const token = store.loadToken();
  if (!token) { ui.sync = { state: 'auth' }; render(); return; }
  ui.sync = { state: 'working' };
  render();
  try {
    const message = `backup: session ${data.sessions.at(-1)?.date ?? todayIso()}`;
    const r = await sync.backup(fetch, token, data, store.loadSyncState().sha, message);
    if (r.status === 'ok') {
      store.saveSyncState({ sha: r.sha, dirty: false });
      ui.sync = null;
    } else if (r.status === 'auth') {
      ui.sync = { state: 'auth' };
    } else if (r.status === 'diverged') {
      ui.sync = { state: 'diverged', remote: r.remote };
    } else {
      ui.sync = { state: 'error', msg: 'GitHub reported a write conflict — retry.' };
    }
  } catch {
    ui.sync = { state: 'error', msg: 'Backup failed — no connection? Data is safe on the phone.' };
  }
  render();
}

const actions = {
  async restore() {
    const token = document.getElementById('token-input').value.trim();
    if (!token) { ui.error = 'Paste the token first.'; return; }
    ui.busy = true;
    ui.error = null;
    render();
    try {
      const remote = await sync.getRemote(fetch, token);
      if (remote.status === 'auth') throw new Error('GitHub rejected the token (401).');
      if (remote.status === 'missing') throw new Error('data.json not found in the data repo.');
      data = H.migrate(L.parseData(JSON.stringify(remote.data)));
      store.saveToken(token);
      store.saveData(data);
      store.saveSyncState({ sha: remote.sha, dirty: false });
    } catch (err) {
      ui.error = err.message;
    }
    ui.busy = false;
    render();
  },
  'save-token'() {
    const token = document.getElementById('token-input').value.trim();
    if (!token) return;
    store.saveToken(token);
    ui.sync = null;
    doBackup();
  },
  retry() { doBackup(); },
  overwrite() {
    const { remote } = ui.sync;
    ui.sync = null;
    const token = store.loadToken();
    // Adopt the remote sha, then run the normal backup PUT against it.
    store.saveSyncState({ sha: remote.sha, dirty: true });
    if (token) doBackup();
  },
  pull() {
    const { remote } = ui.sync;
    data = H.migrate(remote.data);
    store.saveData(data);
    store.saveSyncState({ sha: remote.sha, dirty: false });
    ui.sync = null;
  },
  start() {
    active = L.prefillSession(data, todayIso());
    ui.justFinished = null;
    store.saveActive(active);
  },
  back() { location.hash = ''; ui.dayOpen = null; ui.journey = false; ui.calBack = 0; },
  'cal-back'() { ui.calBack++; },
  'cal-fwd'() { ui.calBack = Math.max(0, ui.calBack - 1); },
  journey() { ui.journey = !ui.journey; },
  'day-open'(el) { ui.dayOpen = el.dataset.iso; },
  'pu-adj'(el) { ui.pushN = Math.max(1, ui.pushN + +el.dataset.d); },
  'pu-add'() {
    H.addPushups(data, todayIso(), ui.pushN);
    store.saveData(data);
    store.saveSyncState({ ...store.loadSyncState(), dirty: true });
    doBackup();
  },
  'day-close'() { ui.dayOpen = null; },
  'sel'(el) {
    const sel = { ei: +el.dataset.e, si: +el.dataset.s };
    ui.sel = (ui.sel && !ui.sel.wu && ui.sel.ei === sel.ei && ui.sel.si === sel.si) ? null : sel;
    ui.confirmFinish = false;
    ui.confirmCancel = false;
  },
  'sel-wu'() { ui.sel = ui.sel?.wu ? null : { wu: true }; ui.confirmFinish = false; ui.confirmCancel = false; },
  adj(el) {
    const { ex, set } = selectedSet();
    L.adjustValue(ex, set, +el.dataset.d);
    store.saveActive(active);
  },
  done() {
    const { set } = selectedSet();
    set.done = !set.done;
    store.saveActive(active);
  },
  axis(el) {
    const { entry, ex, set } = selectedSet();
    L.stepSetting(ex, set, +el.dataset.d);
    L.carryForward(entry, ui.sel.si);
    store.saveActive(active);
  },
  'wu-stretch'() { active.warmup.stretches = !active.warmup.stretches; store.saveActive(active); },
  'wu-adj'(el) { active.warmup.pushups = Math.max(0, active.warmup.pushups + +el.dataset.d); store.saveActive(active); },
  'wu-done'() { active.warmup.done = !active.warmup.done; store.saveActive(active); },
  hist(el) { ui.sheet = { kind: 'history', ex: el.dataset.ex }; ui.sel = null; },
  'add-open'() { ui.sheet = { kind: 'add' }; ui.sel = null; ui.confirmFinish = false; ui.confirmCancel = false; },
  add(el) {
    L.addExercise(data, active, el.dataset.ex);
    ui.sheet = null;
    store.saveActive(active);
  },
  'sheet-close'() { ui.sheet = null; },
  'trend-open'(el) { ui.trendsOpen = ui.trendsOpen === el.dataset.id ? null : el.dataset.id; },
  finish() {
    if (!ui.confirmFinish) { ui.confirmFinish = true; ui.confirmCancel = false; return; }
    const out = L.endSession(data, active, { record: true });
    ui.confirmFinish = false;
    if (!out.ended) return;
    ui.justFinished = out.session.entries.reduce((n, e) => n + e.sets.length, 0);
    store.saveData(data);
    store.saveSyncState({ ...store.loadSyncState(), dirty: true });
    active = null;
    ui.sel = null;
    store.clearActive();
    doBackup();
  },
  cancel() {
    if (!ui.confirmCancel) { ui.confirmCancel = true; ui.confirmFinish = false; return; }
    L.endSession(data, active, { record: false });
    ui.confirmCancel = false;
    active = null;
    ui.sel = null;
    store.clearActive();
  },
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  fn(el);
  render();
});

window.addEventListener('hashchange', render);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

store.requestPersist();
render();
