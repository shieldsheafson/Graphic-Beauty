import { W, H, GRID, effectiveBend, neighborPoints } from './graph.js';
import { R, bezierPoint, splitCubic, bendControls, loopFrame, loopControls } from './geometry.js';

const ARROW = 14;

const esc = s => String(s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = n => n.toFixed(1);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Parameter where the curve leaves a circle of radius r around its start / end.
function exitStart(c, r) {
  let lo = 0, hi = 0.5;
  if (dist(bezierPoint(c, hi), c[0]) < r) return 0;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (dist(bezierPoint(c, mid), c[0]) < r) lo = mid; else hi = mid;
  }
  return hi;
}

function exitEnd(c, r) {
  let lo = 0.5, hi = 1;
  if (dist(bezierPoint(c, lo), c[3]) < r) return 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (dist(bezierPoint(c, mid), c[3]) < r) hi = mid; else lo = mid;
  }
  return lo;
}

function trim(c) {
  const t0 = exitStart(c, R), t1 = exitEnd(c, R);
  if (t1 <= t0) return c;
  const [left] = splitCubic(c, t1);
  return splitCubic(left, t0 / t1)[1];
}

// Control polygon [p0, c1, c2, p3] for an edge in the given graph.
export function edgeControls(g, e) {
  const a = g.vertices.find(v => v.id === e.u);
  const b = g.vertices.find(v => v.id === e.v);
  if (e.ctrl) return [{ x: a.x, y: a.y }, e.ctrl[0], e.ctrl[1], { x: b.x, y: b.y }];
  if (e.u === e.v) {
    const { angle, size } = loopFrame(a.x, a.y, neighborPoints(g, a.id));
    return loopControls(a.x, a.y, angle, size);
  }
  return bendControls(a.x, a.y, b.x, b.y, effectiveBend(g, e));
}

const pathD = ([p0, c1, c2, p3]) =>
  `M${f(p0.x)},${f(p0.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p3.x)},${f(p3.y)}`;

// ---- rendering ------------------------------------------------------------

export function renderGraph(svg, g, { selection = null, editable = false, grid = true } = {}) {
  const id = svg.id;
  const isSel = (type, oid) => selection && selection.type === type && selection.id === oid;
  const marker = name => `<marker id="${id}-${name}" class="arrow ${name}" viewBox="0 0 10 10" refX="10" refY="5"
      markerWidth="${ARROW}" markerHeight="${ARROW}" markerUnits="userSpaceOnUse" orient="auto">
      <path d="M0,0 L10,5 L0,10 z"/></marker>`;

  let s = `<defs>${marker('arrow')}${marker('arrow-sel')}
    <pattern id="${id}-grid" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse">
      <circle cx="0" cy="0" r="1.5" class="grid-dot"/></pattern></defs>
    <rect class="bg" x="0" y="0" width="${W}" height="${H}"/>
    ${grid ? `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#${id}-grid)" pointer-events="none"/>` : ''}`;

  let handles = '';
  for (const e of g.edges) {
    const c = edgeControls(g, e);
    const sel = isSel('edge', e.id);
    s += `<g class="edge${sel ? ' selected' : ''}" data-eid="${e.id}">
      <path class="hit" d="${pathD(c)}"/>
      <path class="line" d="${pathD(trim(c))}"${g.directed ? ` marker-end="url(#${id}-${sel ? 'arrow-sel' : 'arrow'})"` : ''}/>`;
    if (g.weighted) {
      const m = bezierPoint(c, 0.5);
      const a = bezierPoint(c, 0.49), b = bezierPoint(c, 0.51);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      s += `<text class="weight" x="${f(m.x + nx * 16)}" y="${f(m.y + ny * 16)}">${esc(e.weightText)}</text>`;
    }
    s += '</g>';
    if (sel && editable) {
      const [p0, c1, c2, p3] = c;
      handles += `<line class="handle-line" x1="${f(p0.x)}" y1="${f(p0.y)}" x2="${f(c1.x)}" y2="${f(c1.y)}"/>
        <line class="handle-line" x1="${f(p3.x)}" y1="${f(p3.y)}" x2="${f(c2.x)}" y2="${f(c2.y)}"/>
        <circle class="handle" data-handle="0" cx="${f(c1.x)}" cy="${f(c1.y)}" r="7"/>
        <circle class="handle" data-handle="1" cx="${f(c2.x)}" cy="${f(c2.y)}" r="7"/>`;
    }
  }

  for (const v of g.vertices) {
    s += `<g class="vertex${isSel('vertex', v.id) ? ' selected' : ''}" data-vid="${v.id}"
        transform="translate(${f(v.x)},${f(v.y)})">
      <circle r="${R}"/><text>${esc(v.label)}</text></g>`;
  }

  svg.innerHTML = s + handles;
}
