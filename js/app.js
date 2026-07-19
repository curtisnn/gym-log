import * as L from './logic.js';
import * as store from './store.js';

let data = store.loadData();
let active = store.loadActive();

// Transient UI state — never persisted.
const ui = {
  sel: null,          // { ei, si } | { wu: true } | null — cell the editor bar targets
  sheet: null,        // { kind: 'history', ex } | { kind: 'add' } | null
  confirmFinish: false,
  justFinished: null, // set count of the session just saved, shown once on home
  error: null,        // setup import error
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
    <p class="lead">No data on this device yet. Paste the contents of <code>data.json</code>
    from the private data repo to get started.</p>
    ${ui.error ? `<p class="error">${esc(ui.error)}</p>` : ''}
    <textarea id="import-text" rows="10" placeholder='{"exercises": …}'></textarea>
    <button class="primary" data-act="import">Import</button>
  </div>`;
}

function renderHome() {
  const last = data.sessions.at(-1);
  return `<div class="page">
    <h1>Gym Log</h1>
    ${ui.justFinished !== null ? `<p class="saved">Session saved ✓ — ${ui.justFinished} set${ui.justFinished === 1 ? '' : 's'}</p>` : ''}
    <p class="lead">${last
      ? `${data.sessions.length} sessions logged · last ${L.formatDate(last.date)}`
      : 'No sessions yet'}</p>
    <button class="primary" data-act="start">Start session</button>
    <p class="foot"><a href="#rules">Rules</a></p>
  </div>`;
}

function renderRules() {
  const rules = Array.isArray(data?.rules) ? data.rules : [];
  return `<div class="page">
    <div class="topbar"><button data-act="back">‹ Back</button><h1>Rules</h1><span></span></div>
    ${rules.length
      ? `<ul class="rules">${rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`
      : '<p class="lead">No rules in the data file.</p>'}
  </div>`;
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

const actions = {
  import() {
    try {
      data = L.parseData(document.getElementById('import-text').value);
      ui.error = null;
      store.saveData(data);
    } catch (err) {
      ui.error = err.message;
    }
  },
  start() {
    active = L.prefillSession(data, todayIso());
    ui.justFinished = null;
    store.saveActive(active);
  },
  back() { location.hash = ''; },
  'sel'(el) {
    const sel = { ei: +el.dataset.e, si: +el.dataset.s };
    ui.sel = (ui.sel && !ui.sel.wu && ui.sel.ei === sel.ei && ui.sel.si === sel.si) ? null : sel;
    ui.confirmFinish = false;
  },
  'sel-wu'() { ui.sel = ui.sel?.wu ? null : { wu: true }; ui.confirmFinish = false; },
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
  'add-open'() { ui.sheet = { kind: 'add' }; ui.sel = null; ui.confirmFinish = false; },
  add(el) {
    L.addExercise(data, active, el.dataset.ex);
    ui.sheet = null;
    store.saveActive(active);
  },
  'sheet-close'() { ui.sheet = null; },
  finish() {
    if (!ui.confirmFinish) { ui.confirmFinish = true; return; }
    const session = L.finishSession(active);
    ui.confirmFinish = false;
    if (!session) return;
    ui.justFinished = session.entries.reduce((n, e) => n + e.sets.length, 0);
    data.sessions.push(session);
    store.saveData(data);
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

store.requestPersist();
render();
