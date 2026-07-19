// Trends derivations and chart builders. Pure data/strings — no DOM, testable under node.
// Layout per the trends decision (variant D): training-day dot calendar, "road to a
// pull-up" hero, push-up volume hero, expandable cards for dead hang and inverted row.
// Per-session aggregation only; no pace projection; no cadence stats.
import { LABELS } from './logic.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const day = iso => Math.round(new Date(iso + 'T12:00:00Z').getTime() / 86400000);

export const shortDate = iso => {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
};

export function dateSpan(data) {
  const s = data.sessions;
  return s.length ? { t0: day(s[0].date), t1: day(s.at(-1).date) } : { t0: 0, t1: 0 };
}

// One point per session that includes the exercise; reduce turns its sets into
// { y, ...extras } or null to drop the session.
function points(data, exId, reduce) {
  return data.sessions
    .map(s => {
      const e = s.entries.find(x => x.exercise === exId);
      if (!e) return null;
      const p = reduce(e.sets);
      return p ? { date: s.date, ...p } : null;
    })
    .filter(Boolean);
}

// Session best = lightest assist. Lower is better; 0 is the goal.
export function assistSeries(data) {
  return points(data, 'assisted-pull-up', sets => {
    const ys = sets.map(s => s.assistLbs).filter(v => v != null);
    return ys.length ? { y: Math.min(...ys) } : null;
  });
}

export function hangSeries(data) {
  return points(data, 'dead-hang', sets => {
    const ys = sets.map(s => s.seconds).filter(v => v != null);
    return ys.length ? { y: Math.max(...ys) } : null;
  });
}

// Session total reps, carrying the variant so the bar→ground switch can be marked.
export function pushVolumeSeries(data) {
  return points(data, 'push-up', sets => {
    const ys = sets.map(s => s.reps).filter(v => v != null);
    return ys.length ? { y: ys.reduce((a, b) => a + b, 0), variant: sets[0].variant } : null;
  });
}

// Hardest bar height reached in the session, as a 1-based rung on the ladder.
export function rowLevelSeries(data) {
  const ladder = data.exercises.find(e => e.id === 'inverted-row')?.barHeights ?? [];
  return points(data, 'inverted-row', sets => {
    const ys = sets.map(s => ladder.indexOf(s.barHeight) + 1).filter(v => v > 0);
    return ys.length ? { y: Math.max(...ys) } : null;
  });
}

// Vertical-dashed markers where a series' variant changed session-over-session.
export function variantMarks(pts) {
  const marks = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].variant !== pts[i - 1].variant) {
      marks.push({ date: pts[i].date, label: '→ ' + (LABELS[pts[i].variant] ?? pts[i].variant) });
    }
  }
  return marks;
}

// Month grids from the first session's month through today. Display only.
export function calendarMonths(data, todayIso) {
  const on = new Set(data.sessions.map(s => s.date));
  const [ty, tm] = todayIso.split('-').map(Number);
  let [y, m] = (data.sessions[0]?.date ?? todayIso).split('-').map(Number);
  const months = [];
  while (y < ty || (y === ty && m <= tm)) {
    const label = MONTHS[m - 1] + (months.length === 0 || m === 1 ? ` ’${String(y).slice(2)}` : '');
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const days = [];
    for (let d = 1; d <= total; d++) {
      days.push({ n: d, on: on.has(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`) });
    }
    months.push({ label, lead, days });
    m === 12 ? (m = 1, y++) : m++;
  }
  return months;
}

// Session-best line chart. x spans the whole history so all charts align.
// opts: color, h, min, max, invert (lower is better), unit, marks, gridColor, textColor.
export function lineChart(pts, span, o = {}) {
  const W = 420, H = o.h ?? 150, L = 34, R = 12, T = 18, B = 22;
  const grid = o.gridColor ?? 'var(--line)';
  const txt = o.textColor ?? 'var(--dim)';
  const xs = d => L + (W - L - R) * ((day(d) - span.t0) / ((span.t1 - span.t0) || 1));
  const lo = o.min ?? Math.min(...pts.map(p => p.y));
  const hi = o.max ?? Math.max(...pts.map(p => p.y));
  const pad = (hi - lo) * 0.12 || 1;
  const a = o.invert ? hi + pad : lo - pad;
  const b = o.invert ? lo - pad : hi + pad;
  const ys = y => T + (H - T - B) * (1 - (y - a) / (b - a));
  let g = `<svg viewBox="0 0 ${W} ${H}">`;
  for (const v of [lo, hi]) {
    g += `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" stroke="${grid}" stroke-dasharray="2 3"/>`
      + `<text x="${L - 5}" y="${ys(v) + 3}" font-size="10" fill="${txt}" text-anchor="end">${v}${o.unit ?? ''}</text>`;
  }
  for (const m of o.marks ?? []) {
    const x = xs(m.date);
    const flip = x > W * 0.7; // keep the label inside the right edge
    g += `<line x1="${x}" x2="${x}" y1="${T - 4}" y2="${H - B}" stroke="${txt}" stroke-dasharray="3 3" opacity=".6"/>`
      + `<text x="${x + (flip ? -5 : 5)}" y="${T - 8}" font-size="9" fill="${txt}"${flip ? ' text-anchor="end"' : ''}>${m.label}</text>`;
  }
  const path = pts.map((p, i) => (i ? 'L' : 'M') + xs(p.date).toFixed(1) + ' ' + ys(p.y).toFixed(1)).join(' ');
  g += `<path d="${path}" fill="none" stroke="${o.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (const p of pts) {
    g += `<circle cx="${xs(p.date)}" cy="${ys(p.y)}" r="4" fill="${o.color}"/>`
      + `<text x="${xs(p.date)}" y="${ys(p.y) - 8}" font-size="10" font-weight="600" fill="${o.color}" text-anchor="middle">${p.y}</text>`;
  }
  g += `<text x="${xs(pts[0].date)}" y="${H - 6}" font-size="10" fill="${txt}">${shortDate(pts[0].date)}</text>`
    + `<text x="${xs(pts.at(-1).date)}" y="${H - 6}" font-size="10" fill="${txt}" text-anchor="end">${shortDate(pts.at(-1).date)}</text>`;
  return g + '</svg>';
}

export function sparkline(pts, span, color, invert) {
  const W = 110, H = 34;
  const lo = Math.min(...pts.map(p => p.y)), hi = Math.max(...pts.map(p => p.y));
  const a = invert ? hi : lo, b = invert ? lo : hi;
  const xs = d => 4 + (W - 8) * ((day(d) - span.t0) / ((span.t1 - span.t0) || 1));
  const ys = y => 4 + (H - 8) * (1 - (y - a) / ((b - a) || 1));
  const path = pts.map((p, i) => (i ? 'L' : 'M') + xs(p.date).toFixed(1) + ' ' + ys(p.y).toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}"><path d="${path}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
}
