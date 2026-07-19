import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/trends.js';

// Minimal fixture mirroring the real data shape, with a variant switch and gaps.
function fixture() {
  return {
    exercises: [
      { id: 'dead-hang', name: 'Dead hang', metric: 'seconds' },
      { id: 'assisted-pull-up', name: 'Assisted pull-ups', metric: 'reps', tracks: 'assistLbs' },
      { id: 'push-up', name: 'Push-up', metric: 'reps', variants: ['bar-low', 'ground', 'diamond'] },
      { id: 'inverted-row', name: 'Inverted row', metric: 'reps', tracks: 'barHeight', barHeights: ['at-9', 'above-9', 'above-8', 'below-8'] },
    ],
    template: { sections: [] },
    sessions: [
      { date: '2026-05-18', warmup: { stretches: true, pushups: 8 }, entries: [
        { exercise: 'dead-hang', sets: [{ seconds: 20 }, { seconds: 22 }] },
        { exercise: 'assisted-pull-up', sets: [{ reps: 8, assistLbs: 160 }, { reps: 8, assistLbs: 150 }] },
        { exercise: 'push-up', sets: [{ reps: 10, variant: 'bar-low' }, { reps: 8, variant: 'bar-low' }] },
        { exercise: 'inverted-row', sets: [{ reps: 8, barHeight: 'at-9' }, { reps: 8, barHeight: 'above-9' }] },
      ] },
      { date: '2026-06-09', warmup: { stretches: true, pushups: 10 }, entries: [
        // no assisted pull-up this session; a null rep that must not poison the volume sum
        { exercise: 'dead-hang', sets: [{ seconds: 26 }] },
        { exercise: 'push-up', sets: [{ reps: 12, variant: 'bar-low' }, { reps: null, variant: 'bar-low' }] },
      ] },
      { date: '2026-07-13', warmup: { stretches: true, pushups: 10 }, entries: [
        { exercise: 'dead-hang', sets: [{ seconds: 35 }, { seconds: 40 }] },
        { exercise: 'assisted-pull-up', sets: [{ reps: 8, assistLbs: 120 }, { reps: 8, assistLbs: 115 }] },
        { exercise: 'push-up', sets: [{ reps: 8, variant: 'ground' }, { reps: 9, variant: 'ground' }] },
        { exercise: 'inverted-row', sets: [{ reps: 9, barHeight: 'below-8' }, { reps: 10, barHeight: 'above-8' }] },
      ] },
    ],
  };
}

test('assistSeries: session best is the lightest assist; sessions without the exercise are skipped', () => {
  const pts = T.assistSeries(fixture());
  assert.deepEqual(pts.map(p => [p.date, p.y]), [['2026-05-18', 150], ['2026-07-13', 115]]);
});

test('hangSeries: best seconds per session', () => {
  const pts = T.hangSeries(fixture());
  assert.deepEqual(pts.map(p => p.y), [22, 26, 40]);
});

test('pushVolumeSeries: sums non-null reps and carries the variant', () => {
  const pts = T.pushVolumeSeries(fixture());
  assert.deepEqual(pts.map(p => [p.y, p.variant]),
    [[18, 'bar-low'], [12, 'bar-low'], [17, 'ground']]);
});

test('variantMarks: one mark at the session where the variant changed', () => {
  const marks = T.variantMarks(T.pushVolumeSeries(fixture()));
  assert.equal(marks.length, 1);
  assert.equal(marks[0].date, '2026-07-13');
  assert.equal(marks[0].label, '→ ground');
});

test('rowLevelSeries: hardest bar height reached, as a 1-based rung', () => {
  const pts = T.rowLevelSeries(fixture());
  // 5/18 hardest is above-9 (rung 2); 7/13 hardest is below-8 (rung 4); 6/9 skipped
  assert.deepEqual(pts.map(p => [p.date, p.y]), [['2026-05-18', 2], ['2026-07-13', 4]]);
});

test('calendarMonths: spans first-session month through today, marks training days', () => {
  const months = T.calendarMonths(fixture(), '2026-07-18');
  assert.deepEqual(months.map(m => m.label), ['May ’26', 'Jun', 'Jul']);
  // 2026-05-01 is a Friday
  assert.equal(months[0].lead, 5);
  assert.equal(months[0].days.length, 31);
  assert.ok(months[0].days[17].on, 'May 18 is a training day');
  assert.ok(!months[0].days[18].on, 'May 19 is not');
  assert.ok(months[2].days[12].on, 'Jul 13 is a training day');
});

test('lineChart / sparkline: render one point per session with values labelled', () => {
  const data = fixture();
  const span = T.dateSpan(data);
  const chart = T.lineChart(T.hangSeries(data), span, { color: '#fff' });
  assert.ok(chart.startsWith('<svg'));
  assert.equal((chart.match(/<circle/g) ?? []).length, 3);
  assert.ok(chart.includes('>40<'), 'last session best labelled');
  const spark = T.sparkline(T.hangSeries(data), span, '#fff');
  assert.ok(spark.startsWith('<svg') && spark.includes('<path'));
});

test('lineChart: a single-session history still renders', () => {
  const data = fixture();
  data.sessions = data.sessions.slice(0, 1);
  const chart = T.lineChart(T.hangSeries(data), T.dateSpan(data), { color: '#fff' });
  assert.ok(chart.includes('<circle'));
  assert.ok(!chart.includes('NaN'));
});
