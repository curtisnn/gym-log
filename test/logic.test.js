import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

// Minimal fixture mirroring the real data shape.
function fixture() {
  return {
    exercises: [
      { id: 'dead-hang', name: 'Dead hang', metric: 'seconds' },
      { id: 'assisted-pull-up', name: 'Assisted pull-ups', metric: 'reps', tracks: 'assistLbs' },
      { id: 'push-up', name: 'Push-up', metric: 'reps', variants: ['bar-low', 'ground', 'diamond'] },
      { id: 'squat', name: 'Bodyweight squat', metric: 'reps', variants: ['squat', 'split-squat'] },
      { id: 'inverted-row', name: 'Inverted row', metric: 'reps', tracks: 'barHeight', barHeights: ['at-9', 'above-9', 'above-8', 'below-8'] },
      { id: 'spider-man', name: 'Spider-Man', metric: 'reps' },
    ],
    template: { sections: [
      { name: 'Pull-up work', restSeconds: 60, items: [
        { exercise: 'dead-hang', targetSets: 3, targetRange: [20, 30] },
        { exercise: 'assisted-pull-up', targetSets: 3, targetRange: [5, 8] },
      ] },
      { name: 'Main circuit', restSeconds: 30, items: [
        { exercise: 'push-up', targetSets: 3, targetRange: [8, 12] },
        { exercise: 'squat', targetSets: 3, targetRange: [12, 15] },
        { exercise: 'inverted-row', targetSets: 3, targetRange: [8, 12] },
      ] },
      { name: 'Finisher', restSeconds: 20, items: [
        { exercise: 'spider-man', targetSets: 1, targetRange: null },
      ] },
    ] },
    rules: ['Leave 1–2 reps in reserve.'],
    sessions: [
      { date: '2026-07-09', warmup: { stretches: true, pushups: 10 }, entries: [
        { exercise: 'dead-hang', sets: [{ seconds: 31 }, { seconds: 30 }] },
        { exercise: 'assisted-pull-up', sets: [{ reps: 8, assistLbs: 125 }, { reps: 8, assistLbs: 125 }] },
        { exercise: 'push-up', sets: [{ reps: 12, variant: 'bar-low' }] },
        { exercise: 'spider-man', sets: [{ reps: 30 }] },
      ] },
      { date: '2026-07-13', warmup: { stretches: true, pushups: 10 }, entries: [
        { exercise: 'dead-hang', sets: [{ seconds: 35 }, { seconds: 40 }] },
        { exercise: 'assisted-pull-up', sets: [{ reps: 8, assistLbs: 120 }, { reps: 8, assistLbs: 120 }] },
        { exercise: 'push-up', sets: [{ reps: 8, variant: 'ground' }] },
      ] },
      { date: '2026-07-15', warmup: { stretches: true, pushups: 12 }, entries: [
        { exercise: 'dead-hang', sets: [{ seconds: 38 }, { seconds: 38 }] },
        { exercise: 'assisted-pull-up', sets: [{ reps: 8, assistLbs: 115 }, { reps: 8, assistLbs: 115 }] },
        { exercise: 'push-up', sets: [{ reps: 12, variant: 'ground' }] },
      ] },
    ],
  };
}

test('prefill: each exercise fills from its own last appearance, not the last session', () => {
  const data = fixture();
  const s = L.prefillSession(data, '2026-07-18');
  // spider-man was skipped on 7/13 and 7/15 but appeared on 7/9 (within horizon 3) — it survives
  const spider = s.entries.find(e => e.exercise === 'spider-man');
  assert.ok(spider, 'skipped finisher still on the sheet');
  assert.equal(spider.sets[0].reps, 30);
  // assisted pull-up fills from 7/15
  const pu = s.entries.find(e => e.exercise === 'assisted-pull-up');
  assert.equal(pu.sets[0].assistLbs, 115);
  // warm-up pushups from last session; stretches reset
  assert.equal(s.warmup.pushups, 12);
  assert.equal(s.warmup.stretches, false);
  // every set starts undone
  assert.ok(s.entries.every(e => e.sets.every(set => set.done === false)));
});

test('prefill: exercise absent from the last 3 sessions drops off the sheet', () => {
  const data = fixture();
  data.sessions.push(
    { date: '2026-07-16', warmup: { stretches: true, pushups: 10 }, entries: [{ exercise: 'dead-hang', sets: [{ seconds: 38 }] }] },
  );
  const s = L.prefillSession(data, '2026-07-18');
  // spider-man last appeared 4 sessions back — off the sheet, but addable again
  assert.ok(!s.entries.find(e => e.exercise === 'spider-man'));
  assert.ok(L.addableExercises(data, s).some(ex => ex.id === 'spider-man'));
});

test('prefill: never-done exercise seeds from template targets', () => {
  const data = fixture();
  const entry = L.prefillEntry(data, 'squat');
  assert.equal(entry.sets.length, 3);
  assert.deepEqual(entry.sets[0], { reps: 12, variant: 'squat', done: false });
});

test('progression axis: assist weight, bar height, and variant ladders clamp at their ends', () => {
  const data = fixture();
  const pullUp = L.exerciseById(data, 'assisted-pull-up');
  const set = { reps: 8, assistLbs: 5 };
  L.stepSetting(pullUp, set, +1); // harder = less assist
  assert.equal(set.assistLbs, 0);
  L.stepSetting(pullUp, set, +1);
  assert.equal(set.assistLbs, 0, 'clamps at 0');
  L.stepSetting(pullUp, set, -1);
  assert.equal(set.assistLbs, 5);

  const row = L.exerciseById(data, 'inverted-row');
  const rowSet = { reps: 8, barHeight: 'below-8' };
  L.stepSetting(row, rowSet, +1);
  assert.equal(rowSet.barHeight, 'below-8', 'clamps at hardest');
  L.stepSetting(row, rowSet, -1);
  assert.equal(rowSet.barHeight, 'above-8');

  const pushUp = L.exerciseById(data, 'push-up');
  const pSet = { reps: 10, variant: 'bar-low' };
  L.stepSetting(pushUp, pSet, -1);
  assert.equal(pSet.variant, 'bar-low', 'clamps at easiest');
  L.stepSetting(pushUp, pSet, +1);
  assert.equal(pSet.variant, 'ground');
});

test('progression axis: squat → split-squat toggles perLeg', () => {
  const data = fixture();
  const squat = L.exerciseById(data, 'squat');
  const set = { reps: 15, variant: 'squat' };
  L.stepSetting(squat, set, +1);
  assert.equal(set.variant, 'split-squat');
  assert.equal(set.perLeg, true);
  L.stepSetting(squat, set, -1);
  assert.equal(set.variant, 'squat');
  assert.ok(!('perLeg' in set));
});

test('carry-forward: a setting change reaches remaining undone sets only', () => {
  const data = fixture();
  const pullUp = L.exerciseById(data, 'assisted-pull-up');
  const entry = { exercise: 'assisted-pull-up', sets: [
    { reps: 8, assistLbs: 115, done: true },
    { reps: 8, assistLbs: 115, done: false },
    { reps: 8, assistLbs: 115, done: true },
    { reps: 8, assistLbs: 115, done: false },
  ] };
  L.stepSetting(pullUp, entry.sets[1], +1); // 110
  L.carryForward(entry, 1);
  assert.equal(entry.sets[2].assistLbs, 115, 'done set untouched');
  assert.equal(entry.sets[3].assistLbs, 110, 'undone set updated');
  assert.equal(entry.sets[0].assistLbs, 115, 'earlier set untouched');
});

test('finish: records only confirmed sets, drops empty entries, strips done flags', () => {
  const data = fixture();
  const active = L.prefillSession(data, '2026-07-18');
  assert.equal(L.finishSession(active), null, 'nothing done → nothing to save');
  active.entries[0].sets[0].done = true;
  active.entries[0].sets[1].done = true;
  active.warmup.stretches = true;
  const session = L.finishSession(active);
  assert.equal(session.date, '2026-07-18');
  assert.equal(session.entries.length, 1);
  assert.equal(session.entries[0].exercise, 'dead-hang');
  assert.equal(session.entries[0].sets.length, 2);
  assert.ok(!('done' in session.entries[0].sets[0]));
  assert.deepEqual(session.warmup, { stretches: true, pushups: 12 });
});

test('mid-session add: inserts at the template position and pre-fills from history', () => {
  const data = fixture();
  data.sessions.push(
    { date: '2026-07-16', warmup: { stretches: true, pushups: 10 }, entries: [{ exercise: 'dead-hang', sets: [{ seconds: 38 }] }] },
  );
  const active = L.prefillSession(data, '2026-07-18'); // spider-man aged off
  L.addExercise(data, active, 'spider-man');
  const ids = active.entries.map(e => e.exercise);
  assert.equal(ids.at(-1), 'spider-man', 'finisher lands last per template order');
  const spider = active.entries.find(e => e.exercise === 'spider-man');
  assert.equal(spider.sets[0].reps, 30, 'pre-filled from its last appearance ever');
  assert.ok(!L.addableExercises(data, active).some(ex => ex.id === 'spider-man'), 'no longer addable');
});

test('history: last 3 appearances, oldest first, skipping absent sessions', () => {
  const data = fixture();
  const rows = L.historyFor(data, 'spider-man');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-07-09');
  const hangRows = L.historyFor(data, 'dead-hang');
  assert.deepEqual(hangRows.map(r => r.date), ['2026-07-09', '2026-07-13', '2026-07-15']);
});

test('grouping and hints render from the template', () => {
  const data = fixture();
  const active = L.prefillSession(data, '2026-07-18');
  const groups = L.groupEntries(data, active);
  assert.deepEqual(groups.map(g => g.name), ['Pull-up work', 'Main circuit', 'Finisher']);
  assert.equal(groups[0].restSeconds, 60);
  assert.equal(L.targetHint(data, 'dead-hang'), '20–30s');
  assert.equal(L.targetHint(data, 'push-up'), '8–12');
  assert.equal(L.targetHint(data, 'spider-man'), '');
});

test('parseData rejects malformed payloads', () => {
  assert.throws(() => L.parseData('not json'), /valid JSON/);
  assert.throws(() => L.parseData('{"exercises": []}'), /missing/);
  const data = L.parseData(JSON.stringify(fixture()));
  assert.equal(data.sessions.length, 3);
});

test('formatDate', () => {
  assert.equal(L.formatDate('2026-07-09'), 'Jul 9');
  assert.equal(L.formatDate('2026-12-31'), 'Dec 31');
});
