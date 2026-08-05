import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../js/habits.js';

function fixture() {
  return {
    exercises: [{ id: 'push-up', name: 'Push-up', metric: 'reps', variants: ['bar-low', 'ground'] }],
    template: { sections: [] },
    sessions: [
      { date: '2026-08-03', warmup: { stretches: true, pushups: 8 }, entries: [
        { exercise: 'push-up', sets: [{ reps: 12, variant: 'ground' }, { reps: 10, variant: 'ground' }] },
      ] },
    ],
    pushupDays: [],
  };
}

test('migrate: seeds the parked legacy days once, never twice', () => {
  const data = fixture();
  delete data.pushupDays;
  H.migrate(data);
  assert.ok(Array.isArray(data.pushupDays));
  const jun9 = data.pushupDays.find(d => d.date === '2026-06-09');
  assert.deepEqual(jun9.sets, [7, 7, 10, 12, 10, 10]);
  assert.ok(jun9.legacy, 'seeded days keep their noted totals — no gym roll-up on top');
  const n = data.pushupDays.length;
  H.migrate(data);
  assert.equal(data.pushupDays.length, n, 'idempotent');
});

test('pushupDay: rolls up manual entries, warm-up pushups, and gym push-up sets', () => {
  const data = fixture();
  data.pushupDays.push({ date: '2026-08-03', sets: [15, 9] });
  const day = H.pushupDay(data, '2026-08-03');
  assert.deepEqual(day.manual, [15, 9]);
  assert.deepEqual(day.gym, [8, 12, 10], 'warm-up first, then the gym sets');
  assert.equal(day.total, 15 + 9 + 8 + 12 + 10);
});

test('pushupDay: gym-only and manual-only days still count; empty day is null', () => {
  const data = fixture();
  assert.equal(H.pushupDay(data, '2026-08-03').total, 8 + 12 + 10, 'gym day with no manual entries');
  data.pushupDays.push({ date: '2026-08-04', sets: [20] });
  assert.equal(H.pushupDay(data, '2026-08-04').total, 20);
  assert.equal(H.pushupDay(data, '2026-08-05'), null, 'nothing that day');
});

test('pushupDay: legacy days display as noted — no roll-up on top', () => {
  const data = fixture();
  data.sessions.push({ date: '2026-07-13', warmup: { stretches: true, pushups: 10 }, entries: [
    { exercise: 'push-up', sets: [{ reps: 8 }, { reps: 9 }, { reps: 8 }] },
  ] });
  data.pushupDays.push({ date: '2026-07-13', sets: [14, 10], legacy: true });
  const day = H.pushupDay(data, '2026-07-13');
  assert.deepEqual(day.gym, [], 'legacy counts already mixed gym numbers in');
  assert.equal(day.total, 24);
});

test('addPushups: appends to today, creating the day in date order', () => {
  const data = fixture();
  data.pushupDays.push({ date: '2026-08-01', sets: [10] });
  H.addPushups(data, '2026-08-04', 18);
  H.addPushups(data, '2026-08-04', 22);
  assert.deepEqual(data.pushupDays.map(d => d.date), ['2026-08-01', '2026-08-04']);
  assert.deepEqual(data.pushupDays.at(-1).sets, [18, 22]);
  H.addPushups(data, '2026-08-02', 5);
  assert.deepEqual(data.pushupDays.map(d => d.date), ['2026-08-01', '2026-08-02', '2026-08-04'], 'stays sorted');
});

test('recentPushupDays: newest first, rolled up, gym-only days included', () => {
  const data = fixture();
  data.pushupDays.push({ date: '2026-08-04', sets: [4, 18] });
  const days = H.recentPushupDays(data, 5);
  assert.deepEqual(days.map(d => d.date), ['2026-08-04', '2026-08-03'], 'Aug 3 counts via its gym session alone');
  assert.equal(days[0].total, 22);
  assert.equal(days[1].total, 30);
});
