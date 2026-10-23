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
  const e = { id: g.nextId++, u, v, weight, weightText: String(weight), ctrl: null };
  g.edges.push(e);
  return e;
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
