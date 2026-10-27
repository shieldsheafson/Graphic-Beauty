import { W, H, AUTO_BEND, effectiveBend } from './graph.js';
import { R, bendControls, loopFrame, loopControls, sampleCubic } from './geometry.js';

// A flat, fast view of a graph's drawing that the scorers and optimizers share.
//   p      [x0, y0, x1, y1, ...] in graph.vertices order
//   edges  [{ a, b, w, loop, ctrl, src }] with vertex indices (src = index in a parent layout)
//   bend   per-edge bend (see geometry.bendControls); unused for loops and ctrl edges
//   polys  per-edge sampled shape; straight edges are just their two endpoints
//   boxes  per-edge bounding box [x0, y0, x1, y1, ...]
//   curved per-edge flag
//   nbrs   per-vertex neighbour indices (non-loop edges), used to aim loops
//   pairs  antiparallel edge pairs [k1, k2]
//   rank   per-vertex position of its label in a, b, …, z, aa, … order

const CURVE_SEGMENTS = 8;
const LOOP_SEGMENTS = 12;
const FIT_PAD = 24;

function makeLayout(n, p, edges, bend, { weighted, directed, rank }) {
  const m = edges.length;
  const nbrs = Array.from({ length: n }, () => new Set());
  const incident = Array.from({ length: n }, () => []);
  const pairs = [];
  edges.forEach((e, k) => {
    incident[e.a].push(k);
    if (!e.loop) incident[e.b].push(k);
    if (e.loop) return;
    nbrs[e.a].add(e.b);
    nbrs[e.b].add(e.a);
    for (let j = 0; j < k; j++) {
      if (edges[j].a === e.b && edges[j].b === e.a) pairs.push([j, k]);
    }
  });
  const L = {
    n, m, p, edges, bend, weighted, directed, rank, pairs, incident,
    nbrs: nbrs.map(s => [...s]),
    polys: new Array(m),
    boxes: new Float64Array(4 * m),
    curved: new Uint8Array(m),
  };
  updatePolys(L);
  return L;
}

// keepCtrl: score user-drawn curves as drawn (for display); optimizers drop them.
export function buildLayout(graph, { keepCtrl = false } = {}) {
  const index = new Map(graph.vertices.map((v, i) => [v.id, i]));
  const p = new Float64Array(graph.vertices.length * 2);
  graph.vertices.forEach((v, i) => { p[2 * i] = v.x; p[2 * i + 1] = v.y; });
  const edges = graph.edges.map((e, k) => ({
    a: index.get(e.u),
    b: index.get(e.v),
    w: e.weight,
    loop: e.u === e.v,
    ctrl: keepCtrl && e.ctrl ? e.ctrl.map(c => ({ ...c })) : null,
    src: k,
  }));
  const bend = Float64Array.from(graph.edges, e => (e.u === e.v ? 0 : effectiveBend(graph, e)));
  // Labels sort like their default names: shorter first, then alphabetically.
  const labels = graph.vertices.map(v => v.label);
  const sorted = [...new Set(labels)].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  const rank = Int32Array.from(labels, l => sorted.indexOf(l));
  return makeLayout(graph.vertices.length, p, edges, bend,
    { weighted: graph.weighted, directed: graph.directed, rank });
}

// The layout restricted to `vertices` (indices into L), in that order.
// Edges keep their index in L as `src` so results can be written back.
export function subLayout(L, vertices) {
  const index = new Map(vertices.map((v, i) => [v, i]));
  const p = new Float64Array(vertices.length * 2);
  vertices.forEach((v, i) => { p[2 * i] = L.p[2 * v]; p[2 * i + 1] = L.p[2 * v + 1]; });
  const edges = [];
  const bend = [];
  L.edges.forEach((e, k) => {
    if (!index.has(e.a) || !index.has(e.b)) return;
    edges.push({ ...e, a: index.get(e.a), b: index.get(e.b), src: k });
    bend.push(L.bend[k]);
  });
  return makeLayout(vertices.length, p, edges, Float64Array.from(bend),
    { weighted: L.weighted, directed: L.directed, rank: Int32Array.from(vertices, v => L.rank[v]) });
}

export function edgeShape(L, k) {
  const e = L.edges[k], p = L.p;
  const ax = p[2 * e.a], ay = p[2 * e.a + 1];
  if (e.loop) {
    const nb = L.nbrs[e.a].map(j => ({ x: p[2 * j], y: p[2 * j + 1] }));
    const { angle, size } = loopFrame(ax, ay, nb);
    return loopControls(ax, ay, angle, size);
  }
  const bx = p[2 * e.b], by = p[2 * e.b + 1];
  if (e.ctrl) return [{ x: ax, y: ay }, e.ctrl[0], e.ctrl[1], { x: bx, y: by }];
  return bendControls(ax, ay, bx, by, L.bend[k]);
}

// How far the control points stray from the chord, relative to its length.
function ctrlBend(c) {
  const dx = c[3].x - c[0].x, dy = c[3].y - c[0].y;
  const len = Math.hypot(dx, dy) || 1;
  const off = q => Math.abs((q.x - c[0].x) * dy - (q.y - c[0].y) * dx) / len;
  return Math.max(off(c[1]), off(c[2])) / len;
}

export function updatePolys(L) {
  const { p, boxes } = L;
  for (let k = 0; k < L.m; k++) {
    const e = L.edges[k];
    const straight = !e.loop && (e.ctrl ? ctrlBend(edgeShape(L, k)) < 0.01 : Math.abs(L.bend[k]) < 1e-3);
    let poly;
    if (straight) {
      poly = Float64Array.of(p[2 * e.a], p[2 * e.a + 1], p[2 * e.b], p[2 * e.b + 1]);
    } else {
      poly = sampleCubic(edgeShape(L, k), e.loop ? LOOP_SEGMENTS : CURVE_SEGMENTS);
    }
    L.polys[k] = poly;
    L.curved[k] = straight ? 0 : 1;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]);
      y0 = Math.min(y0, poly[i + 1]); y1 = Math.max(y1, poly[i + 1]);
    }
    boxes[4 * k] = x0; boxes[4 * k + 1] = y0; boxes[4 * k + 2] = x1; boxes[4 * k + 3] = y1;
  }
}

// Vertices evenly around a circle, straight edges except antiparallel pairs.
// Chords of a circle can't lie along each other, so this layout never has
// overlapping edges: the fallback when an optimizer can't find one that doesn't.
export function placeOnCircle(L) {
  const r = Math.min(W, H) / 2 - 2 * R;
  for (let i = 0; i < L.n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / L.n;
    L.p[2 * i] = W / 2 + r * Math.cos(a);
    L.p[2 * i + 1] = H / 2 + r * Math.sin(a);
  }
  L.bend.fill(0);
  for (const [k1, k2] of L.pairs) { L.bend[k1] = AUTO_BEND; L.bend[k2] = AUTO_BEND; }
  updatePolys(L);
}

// Bounding box of everything drawn: vertex discs and edge shapes.
function extent(L) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < L.n; i++) {
    x0 = Math.min(x0, L.p[2 * i] - R); x1 = Math.max(x1, L.p[2 * i] + R);
    y0 = Math.min(y0, L.p[2 * i + 1] - R); y1 = Math.max(y1, L.p[2 * i + 1] + R);
  }
  for (let k = 0; k < L.m; k++) {
    x0 = Math.min(x0, L.boxes[4 * k]); y0 = Math.min(y0, L.boxes[4 * k + 1]);
    x1 = Math.max(x1, L.boxes[4 * k + 2]); y1 = Math.max(y1, L.boxes[4 * k + 3]);
  }
  return { x0, y0, x1, y1 };
}

// How much fitLayout would enlarge this layout. Vertex discs don't grow with
// the layout, so solve for the part of the extent that does.
export function fitScale(L) {
  const { x0, y0, x1, y1 } = extent(L);
  if (!L.n || Math.max(x1 - x0, y1 - y0) - 2 * R <= 1) return 1;
  const sx = (W - 2 * FIT_PAD - 2 * R) / Math.max(1e-6, x1 - x0 - 2 * R);
  const sy = (H - 2 * FIT_PAD - 2 * R) / Math.max(1e-6, y1 - y0 - 2 * R);
  return Math.min(sx, sy);
}

// Uniformly scale and center the layout so its drawing fills the canvas.
// Loops and discs don't scale exactly with it, so it takes two passes to settle.
export function fitLayout(L) {
  if (!L.n) return;
  for (let pass = 0; pass < 2; pass++) {
    const { x0, y0, x1, y1 } = extent(L);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const s = fitScale(L);
    for (let i = 0; i < L.n; i++) {
      L.p[2 * i] = W / 2 + (L.p[2 * i] - cx) * s;
      L.p[2 * i + 1] = H / 2 + (L.p[2 * i + 1] - cy) * s;
    }
    updatePolys(L);
  }
}
