// Rules-page content builder. Pure strings — no DOM, testable under node.
// Renders the strength progression plan: the global advance rule up top, then one
// card per track (opens/closes/feeds-into, level ladder with the current level
// marked). Display only — the app never evaluates open/close conditions or
// advance triggers; reading the plan mid-workout is the whole feature.

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function trackCard(t) {
  const meta = [
    `<p class="tmeta"><span class="k">Opens</span> ${esc(t.opens)}</p>`,
    `<p class="tmeta"><span class="k">Closes</span> ${esc(t.closes)}</p>`,
    t.feedsInto ? `<p class="tmeta"><span class="k">Feeds into</span> ${esc(t.feedsInto)}</p>` : '',
    t.note ? `<p class="tmeta note">${esc(t.note)}</p>` : '',
  ].join('');
  const rows = (t.levels || []).map((lv, i) => {
    const n = i + 1;
    const cur = t.current === n;
    return `<tr${cur ? ' class="cur"' : ''}>
      <td class="n">${n}</td>
      <td>${esc(lv.exercise)}${cur ? ' <span class="now">now</span>' : ''}</td>
      <td class="trig">${lv.trigger == null ? '—' : esc(lv.trigger)}</td>
    </tr>`;
  }).join('');
  return `<section class="card track">
    <h2>${esc(t.name)}</h2>
    ${meta}
    <table class="ladder">${rows}</table>
  </section>`;
}

// Content for the Rules page body (the page wrapper and topbar live in app.js).
// Anything but the structured { global, tracks } shape gets the empty message.
export function rulesHtml(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules) || !Array.isArray(rules.tracks)) {
    return '<p class="lead">No rules in the data file.</p>';
  }
  return `${rules.global ? `<p class="globalrule">${esc(rules.global)}</p>` : ''}
    ${rules.tracks.map(trackCard).join('')}`;
}
