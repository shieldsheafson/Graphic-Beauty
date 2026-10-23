import { W, H, GRID } from './graph.js';

// Layouts are flat Float64Arrays [x0, y0, x1, y1, ...] indexed like graph.vertices.
// ctx = { n, edges: [[i, j, weight]] (self-loops excluded), weighted }
// Every cost is "lower is prettier", scaled to roughly [0, 1].

const MIN_VERTEX_GAP = 70;
const MIN_EDGE_GAP = 24;

export function buildContext(graph) {
  const index = new Map(graph.vertices.map((v, i) => [v.id, i]));
  const p = new Float64Array(graph.vertices.length * 2);
  graph.vertices.forEach((v, i) => { p[2 * i] = v.x; p[2 * i + 1] = v.y; });
  const edges = graph.edges
    .filter(e => e.u !== e.v)
    .map(e => [index.get(e.u), index.get(e.v), e.weight]);
  return { p, ctx: { n: graph.vertices.length, edges, weighted: graph.weighted } };
}

const cv2 = xs => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return 0;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return v / (mean * mean);
};

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

function crosses(p, [a, b], [c, d]) {
  if (a === c || a === d || b === c || b === d) return false;
  const ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * b], by = p[2 * b + 1];
  const cx = p[2 * c], cy = p[2 * c + 1], dx = p[2 * d], dy = p[2 * d + 1];
  return orient(ax, ay, bx, by, cx, cy) * orient(ax, ay, bx, by, dx, dy) < 0
    && orient(cx, cy, dx, dy, ax, ay) * orient(cx, cy, dx, dy, bx, by) < 0;
}

function pointSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

export const HEURISTICS = [
  {
    id: 'area',
    name: 'Graph area',
    cost(p, { n }) {
      if (n < 2) return 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        x0 = Math.min(x0, p[2 * i]); x1 = Math.max(x1, p[2 * i]);
        y0 = Math.min(y0, p[2 * i + 1]); y1 = Math.max(y1, p[2 * i + 1]);
      }
      return ((x1 - x0) * (y1 - y0)) / (W * H);
    },
  },
  {
    id: 'edgeLength',
    name: 'Edge length variance',
    // Weighted graphs aim for length proportional to weight.
    cost(p, { edges, weighted }) {
      return Math.min(1, cv2(edges.map(([a, b, w]) => {
        const len = Math.hypot(p[2 * a] - p[2 * b], p[2 * a + 1] - p[2 * b + 1]);
        return weighted && w > 0 ? len / w : len;
      })));
    },
  },
  {
    id: 'density',
    name: 'Vertex density variance',
    // Spread of nearest-neighbour distances: even spacing scores 0.
    cost(p, { n }) {
      if (n < 3) return 0;
      const nn = [];
      for (let i = 0; i < n; i++) {
        let best = Infinity;
        for (let j = 0; j < n; j++) {
          if (i !== j) best = Math.min(best, Math.hypot(p[2 * i] - p[2 * j], p[2 * i + 1] - p[2 * j + 1]));
        }
        nn.push(best);
      }
      return Math.min(1, cv2(nn));
    },
  },
  {
    id: 'center',
    name: 'Distance from center',
    // How far the vertex centroid sits from the canvas center.
    cost(p, { n }) {
      if (n === 0) return 0;
      let sx = 0, sy = 0;
      for (let i = 0; i < n; i++) { sx += p[2 * i]; sy += p[2 * i + 1]; }
      return Math.hypot(sx / n - W / 2, sy / n - H / 2) / Math.hypot(W / 2, H / 2);
    },
  },
  {
    id: 'crossings',
    name: 'Minimize crossings',
    cost(p, { edges }) {
      let count = 0;
      for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) if (crosses(p, edges[i], edges[j])) count++;
      }
      return count / Math.max(1, edges.length);
    },
  },
  {
    id: 'grid',
    name: 'Vertices on the grid',
    cost(p, { n }) {
      if (n === 0) return 0;
      let s = 0;
      for (let i = 0; i < n; i++) {
        const dx = p[2 * i] - Math.round(p[2 * i] / GRID) * GRID;
        const dy = p[2 * i + 1] - Math.round(p[2 * i + 1] / GRID) * GRID;
        s += Math.hypot(dx, dy);
      }
      return s / n / (GRID / Math.SQRT2);
    },
  },
];

export const BY_ID = Object.fromEntries(HEURISTICS.map(h => [h.id, h]));

// Always-on legibility constraints: vertices must not crowd each other or
// sit on top of edges they don't belong to. Without this, "area" would
// collapse the graph to a point.
export function penalty(p, { n, edges }) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(p[2 * i] - p[2 * j], p[2 * i + 1] - p[2 * j + 1]);
      if (d < MIN_VERTEX_GAP) s += ((MIN_VERTEX_GAP - d) / MIN_VERTEX_GAP) ** 2;
    }
    for (const [a, b] of edges) {
      if (a === i || b === i) continue;
      const d = pointSegmentDist(p[2 * i], p[2 * i + 1], p[2 * a], p[2 * a + 1], p[2 * b], p[2 * b + 1]);
      if (d < MIN_EDGE_GAP) s += ((MIN_EDGE_GAP - d) / MIN_EDGE_GAP) ** 2;
    }
  }
  return s;
}

export function evaluate(graph) {
  const { p, ctx } = buildContext(graph);
  return Object.fromEntries(HEURISTICS.map(h => [h.id, h.cost(p, ctx)]));
}
