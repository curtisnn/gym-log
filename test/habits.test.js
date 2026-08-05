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

// --- the 90/90/1 vote (issue #17) ---

test('migrate: creates the vote chain — 90 days from 2026-08-04, eFinalDate, empty', () => {
  const data = fixture();
  H.migrate(data);
  assert.equal(data.vote.start, '2026-08-04');
  assert.equal(data.vote.thing, 'eFinalDate');
  assert.deepEqual(data.vote.days, []);
  data.vote.days.push('2026-08-04');
  H.migrate(data);
  assert.deepEqual(data.vote.days, ['2026-08-04'], 'idempotent — never resets an existing chain');
});

test('toggleVote: one tap votes, another un-votes; the chain stays ordered', () => {
  const data = H.migrate(fixture());
  H.toggleVote(data, '2026-08-05');
  H.toggleVote(data, '2026-08-04');
  assert.deepEqual(data.vote.days, ['2026-08-04', '2026-08-05']);
  H.toggleVote(data, '2026-08-05');
  assert.deepEqual(data.vote.days, ['2026-08-04'], 'mis-tap recovery');
});

test('voteStatus: arc marches from the start date; streak counts days in a row', () => {
  const data = H.migrate(fixture());
  let st = H.voteStatus(data, '2026-08-04');
  assert.deepEqual({ day: st.dayOfArc, voted: st.voted, streak: st.streak },
    { day: 1, voted: false, streak: 0 }, 'day 1, nothing yet');
  H.toggleVote(data, '2026-08-04');
  st = H.voteStatus(data, '2026-08-04');
  assert.deepEqual({ day: st.dayOfArc, voted: st.voted, streak: st.streak },
    { day: 1, voted: true, streak: 1 });
  H.toggleVote(data, '2026-08-05');
  // miss the 6th, vote the 7th
  H.toggleVote(data, '2026-08-07');
  st = H.voteStatus(data, '2026-08-07');
  assert.equal(st.dayOfArc, 4, 'a missed day never resets the arc');
  assert.equal(st.streak, 1, 'a missed day resets the streak');
});

test('voteStatus: an unvoted today does not break yesterday’s streak', () => {
  const data = H.migrate(fixture());
  for (const d of ['2026-08-04', '2026-08-05', '2026-08-06']) H.toggleVote(data, d);
  const st = H.voteStatus(data, '2026-08-07');
  assert.equal(st.streak, 3, 'streak holds until the day is actually missed');
  assert.equal(st.voted, false);
});

test('voteStatus: the arc completes at 90 and says so', () => {
  const data = H.migrate(fixture());
  const st = H.voteStatus(data, '2026-11-05'); // day 94
  assert.equal(st.dayOfArc, 90, 'caps at the arc length');
  assert.ok(st.complete);
  assert.ok(!H.voteStatus(data, '2026-11-01').complete, 'day 90 exactly is the last arc day');
});

test('voteChain: 90 cells — voted, missed, today, future', () => {
  const data = H.migrate(fixture());
  for (const d of ['2026-08-04', '2026-08-06']) H.toggleVote(data, d);
  const chain = H.voteChain(data, '2026-08-06');
  assert.equal(chain.length, 90);
  assert.equal(chain[0].iso, '2026-08-04');
  assert.equal(chain[0].state, 'voted');
  assert.equal(chain[1].state, 'missed', 'past unvoted day');
  assert.equal(chain[2].state, 'voted');
  assert.ok(chain[2].today);
  assert.equal(chain[3].state, 'future');
  assert.equal(chain.at(-1).iso, '2026-11-01');
});

// --- catalog ladders mirror the Rules tracks (issue #18) ---

test('migrate: extends catalog ladders to the full tracks, preserving existing ids', () => {
  const data = fixture();
  data.exercises = [
    { id: 'dead-hang', name: 'Dead hang', metric: 'seconds' },
    { id: 'scapular-pulls', name: 'Scapular pulls', metric: 'reps' },
    { id: 'push-up', name: 'Push-up', metric: 'reps', variants: ['bar-low', 'ground', 'diamond'] },
    { id: 'squat', name: 'Bodyweight squat', metric: 'reps', variants: ['squat', 'split-squat'] },
  ];
  H.migrate(data);
  const ex = id => data.exercises.find(e => e.id === id);
  assert.deepEqual(ex('dead-hang').variants, ['relaxed', 'active']);
  assert.deepEqual(ex('scapular-pulls').variants, ['regular', 'paused-top']);
  assert.deepEqual(ex('push-up').variants,
    ['knee', 'bar-high', 'bar-low', 'ground', 'diamond', 'decline', 'archer', 'pseudo-planche', 'one-arm'],
    'old ids keep their place inside the full track');
  assert.deepEqual(ex('squat').variants, ['squat', 'split-squat', 'bulgarian', 'bulgarian-loaded']);
  assert.ok(ex('negative-pull-up'), 'the feeds-into boundary becomes a new addable exercise');
  const n = data.exercises.length;
  H.migrate(data);
  assert.equal(data.exercises.length, n, 'idempotent');
});

test('migrate: backfills the base variant onto historical laddered sets', () => {
  const data = fixture();
  data.exercises.push({ id: 'dead-hang', name: 'Dead hang', metric: 'seconds' });
  data.sessions.push({ date: '2026-07-30', warmup: { stretches: true, pushups: 8 }, entries: [
    { exercise: 'dead-hang', sets: [{ seconds: 40 }, { seconds: 35 }] },
  ] });
  H.migrate(data);
  assert.equal(data.sessions.at(-1).entries[0].sets[0].variant, 'relaxed',
    'history recorded before the ladder existed sits at the base level');
});

test('after migrate, dead hang pre-fills at its recorded level and can step to active', async () => {
  const L = await import('../js/logic.js');
  const data = fixture();
  data.exercises.push({ id: 'dead-hang', name: 'Dead hang', metric: 'seconds' });
  data.template.sections.push({ name: 'Pull-up work', restSeconds: 60, items: [
    { exercise: 'dead-hang', targetSets: 3, targetRange: [20, 30] },
  ] });
  data.sessions.push({ date: '2026-08-03', warmup: { stretches: true, pushups: 8 }, entries: [
    { exercise: 'dead-hang', sets: [{ seconds: 40 }, { seconds: 38 }] },
  ] });
  H.migrate(data);
  const entry = L.prefillEntry(data, 'dead-hang');
  assert.equal(entry.sets[0].variant, 'relaxed', 'history backfill carries into pre-fill');
  const ex = data.exercises.find(e => e.id === 'dead-hang');
  L.stepSetting(ex, entry.sets[0], 1);
  L.carryForward(entry, 0);
  assert.ok(entry.sets.every(s => s.variant === 'active'), 'the advance finally has a place to live');
});

test('migrate: stamps the schema so boot knows when an upgrade is due', () => {
  const data = fixture();
  assert.notEqual(data.schema, H.SCHEMA);
  H.migrate(data);
  assert.equal(data.schema, H.SCHEMA);
});
