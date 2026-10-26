// Graph model shared by the editor and the beautified copy.
// Coordinates live in a fixed logical canvas (the SVG viewBox).

export const W = 800;
export const H = 600;
export const GRID = 50;
export const MARGIN = 40;

export function createGraph({ directed = false, weighted = false } = {}) {
  return { directed, weighted, vertices: [], edges: [], nextId: 1 };
}

// 0 -> a, 25 -> z, 26 -> aa, ...
export function labelFor(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

export function nextLabel(g) {
  const used = new Set(g.vertices.map(v => v.label));
  for (let i = 0; ; i++) {
    const l = labelFor(i);
    if (!used.has(l)) return l;
  }
}

export function getVertex(g, id) {
  return g.vertices.find(v => v.id === id);
}

export function getEdge(g, id) {
  return g.edges.find(e => e.id === id);
}

export function addVertex(g, x, y) {
  const v = { id: g.nextId++, label: nextLabel(g), x, y };
  g.vertices.push(v);
  return v;
}

export function findEdge(g, u, v) {
  return g.edges.find(e =>
    (e.u === u && e.v === v) || (!g.directed && e.u === v && e.v === u));
}

// Returns the existing edge instead of creating a duplicate.
export function addEdge(g, u, v, weight = 1) {
  const existing = findEdge(g, u, v);
  if (existing) return existing;
  // bend: null = automatic (see effectiveBend); ctrl: user-dragged control points.
  const e = { id: g.nextId++, u, v, weight, weightText: String(weight), bend: null, ctrl: null };
  g.edges.push(e);
  return e;
}

// Antiparallel directed edges bend apart automatically so both stay visible.
export const AUTO_BEND = 0.2;

export function effectiveBend(g, e) {
  if (e.bend != null) return e.bend;
  return g.directed && g.edges.some(o => o !== e && o.u === e.v && o.v === e.u) ? AUTO_BEND : 0;
}

// Positions of the vertices joined to `id` by non-loop edges (used to aim loops).
export function neighborPoints(g, id) {
  const ids = new Set();
  for (const e of g.edges) {
    if (e.u === e.v) continue;
    if (e.u === id) ids.add(e.v);
    else if (e.v === id) ids.add(e.u);
  }
  return g.vertices.filter(v => ids.has(v.id));
}

export function removeVertex(g, id) {
  g.vertices = g.vertices.filter(v => v.id !== id);
  g.edges = g.edges.filter(e => e.u !== id && e.v !== id);
}

export function removeEdge(g, id) {
  g.edges = g.edges.filter(e => e.id !== id);
}

export function cloneGraph(g) {
  return structuredClone(g);
}

export function clampToCanvas(x, y, pad = MARGIN) {
  return {
    x: Math.min(W - pad, Math.max(pad, x)),
    y: Math.min(H - pad, Math.max(pad, y)),
  };
}

// ---- import / export --------------------------------------------------------

export function serializeGraph(g) {
  return JSON.stringify({
    format: 'graphic-beauty',
    version: 1,
    directed: g.directed,
    weighted: g.weighted,
    vertices: g.vertices.map(({ id, label, x, y }) => ({ id, label, x, y })),
    edges: g.edges.map(({ u, v, weight, bend, ctrl }) => ({ u, v, weight, bend, ctrl })),
  }, null, 2);
}

// Throws an Error with a readable message if the text isn't a usable graph.
export function parseGraph(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!data || !Array.isArray(data.vertices) || !Array.isArray(data.edges)) {
    throw new Error('Expected an object with "vertices" and "edges" lists.');
  }
  const num = (x, fallback) => (Number.isFinite(x) ? x : fallback);
  const g = createGraph({ directed: !!data.directed, weighted: !!data.weighted });
  const ids = new Set();
  for (const v of data.vertices) {
    const id = num(v.id, NaN);
    if (!Number.isInteger(id) || ids.has(id)) throw new Error('Every vertex needs a unique integer "id".');
    ids.add(id);
    const p = clampToCanvas(num(v.x, W / 2), num(v.y, H / 2), 0);
    g.vertices.push({ id, label: v.label == null ? '' : String(v.label), x: p.x, y: p.y });
  }
  g.nextId = Math.max(0, ...ids) + 1;
  for (const e of data.edges) {
    if (!ids.has(e.u) || !ids.has(e.v) || findEdge(g, e.u, e.v)) continue;
    const ctrl = Array.isArray(e.ctrl) && e.ctrl.length === 2 && e.ctrl.every(c => Number.isFinite(c?.x) && Number.isFinite(c?.y))
      ? e.ctrl.map(c => ({ x: c.x, y: c.y })) : null;
    const weight = num(e.weight, 1);
    g.edges.push({
      id: g.nextId++, u: e.u, v: e.v, weight, weightText: String(weight),
      bend: Number.isFinite(e.bend) ? e.bend : null, ctrl,
    });
  }
  return g;
}
