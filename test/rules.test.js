import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rulesHtml } from '../js/rules.js';

const plan = {
  global: 'Advance after two clean sessions.',
  tracks: [
    {
      name: 'Push-Up', opens: 'Immediately available.', closes: 'Never.', feedsInto: null,
      note: null, current: 2,
      levels: [
        { exercise: 'Knee push-up', trigger: '3×15 clean' },
        { exercise: 'Standard push-up', trigger: '3×12–15 clean' },
      ],
    },
    {
      name: 'Dead Hang', opens: 'Immediately available.', closes: 'Level 2 hit.',
      feedsInto: 'Eccentric Negative Pull-Up', note: 'Relax the arms.',
      levels: [{ exercise: 'Dead hang', trigger: null }],
    },
  ],
};

test('renders the global rule and every track name', () => {
  const h = rulesHtml(plan);
  assert.match(h, /Advance after two clean sessions\./);
  assert.match(h, /Push-Up/);
  assert.match(h, /Dead Hang/);
});

test('marks only the current level row', () => {
  const h = rulesHtml(plan);
  assert.equal((h.match(/class="cur"/g) || []).length, 1);
  assert.match(h, /Standard push-up <span class="now">now<\/span>/);
  assert.doesNotMatch(h, /Knee push-up <span/);
});

test('renders feeds-into and note only when present', () => {
  const h = rulesHtml(plan);
  assert.equal((h.match(/Feeds into/g) || []).length, 1);
  assert.match(h, /Relax the arms\./);
});

test('null trigger renders as a dash', () => {
  assert.match(rulesHtml(plan), /<td class="trig">—<\/td>/);
});

test('escapes HTML in plan strings', () => {
  const h = rulesHtml({
    global: 'a < b',
    tracks: [{ name: '<img>', opens: 'x', closes: 'y', levels: [{ exercise: 'a & b', trigger: '"q"' }] }],
  });
  assert.doesNotMatch(h, /<img>/);
  assert.match(h, /a &lt; b/);
  assert.match(h, /a &amp; b/);
  assert.match(h, /&quot;q&quot;/);
});

test('missing, array, or malformed rules fall back to the empty message', () => {
  for (const bad of [undefined, null, ['old', 'flat', 'list'], {}, { global: 'x' }]) {
    assert.match(rulesHtml(bad), /No rules in the data file\./);
  }
});
