import { W, H } from './graph.js';
import { R } from './geometry.js';
import { buildLayout, fitScale } from './layout.js';

// Every rule scores a layout (see layout.js), "lower is prettier", roughly in
// [0, 1]. Edge shapes are the sampled curves that are actually drawn.

const MIN_VERTEX_GAP = 70;
const CLEARANCE = R + 6; // an edge closer than this to a vertex's centre runs through it
const OVERLAP_ANGLE = 0.15; // radians: edges leaving a vertex this close together look merged
const MIN_PAIR_SEPARATION = 0.3; // bend difference that keeps antiparallel edges apart

const cv2 = xs => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return 0;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return v / (mean * mean);
};

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function polyDist(px, py, poly) {
  let d = Infinity;
  for (let i = 0; i + 3 < poly.length; i += 2) {
    d = Math.min(d, segDist(px, py, poly[i], poly[i + 1], poly[i + 2], poly[i + 3]));
  }
  return d;
}

// Where segment ab meets segment cd, as a parameter along ab, or -1.
// Touching and collinear overlap count as meeting.
function segHit(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const qx = cx - ax, qy = cy - ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) {
    const len = Math.hypot(rx, ry);
    if (!len || Math.abs(qx * ry - qy * rx) / len > 0.5) return -1;
    const t0 = (qx * rx + qy * ry) / (len * len);
    const t1 = ((dx - ax) * rx + (dy - ay) * ry) / (len * len);
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
    return lo <= hi ? (lo + hi) / 2 : -1;
  }
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

const boxesMeet = (B, i, j, pad) =>
  B[4 * i] - pad <= B[4 * j + 2] && B[4 * j] - pad <= B[4 * i + 2]
  && B[4 * i + 1] - pad <= B[4 * j + 3] && B[4 * j + 1] - pad <= B[4 * i + 3];

// ---- overlapping edges ----------------------------------------------------
// Two edges overlap when their drawings run within OVERLAP_DIST of each other,
// nearly parallel, for at least OVERLAP_MIN_LEN outside any shared vertex's
// disc. This is never allowed in a beautified layout (see optimizers).
// Distances are in screen pixels after the layout is fitted to the pane:
// scaling up stretches the run where a curve grazes another edge.

const OVERLAP_DIST = 4;
const OVERLAP_MIN_LEN = 6;
const OVERLAP_MAX_SIN = 0.2; // ~11°; steeper meetings are crossings, not overlaps
// Optimizers test with this much extra slack, so nothing they accept sits
// right at the threshold of the final check.
export const OVERLAP_MARGIN = 1.5;

// Midpoint [x, y] of the stretch where segment cd runs within `tol` of segment
// ab for at least `minLen`, or null.
function segOverlap(ax, ay, bx, by, cx, cy, dx, dy, tol, minLen) {
  const len = Math.hypot(bx - ax, by - ay), len2 = Math.hypot(dx - cx, dy - cy);
  if (len < 1e-9 || len2 < 1e-9) return null;
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  if (Math.abs(ux * (dy - cy) - uy * (dx - cx)) / len2 > OVERLAP_MAX_SIN) return null;
  // Signed distance from line ab and position along it, for c and d.
  const hc = (cx - ax) * uy - (cy - ay) * ux, hd = (dx - ax) * uy - (dy - ay) * ux;
  const tc = (cx - ax) * ux + (cy - ay) * uy, td = (dx - ax) * ux + (dy - ay) * uy;
  // Part of cd (parameter s in [0, 1]) within OVERLAP_DIST of the line.
  let s0 = 0, s1 = 1;
  if (Math.abs(hd - hc) < 1e-9) {
    if (Math.abs(hc) > tol) return null;
  } else {
    const a = (-tol - hc) / (hd - hc), b = (tol - hc) / (hd - hc);
    s0 = Math.max(0, Math.min(a, b));
    s1 = Math.min(1, Math.max(a, b));
    if (s0 > s1) return null;
  }
  // ...and of that, the part lying alongside ab itself.
  const t0 = Math.max(0, Math.min(tc + s0 * (td - tc), tc + s1 * (td - tc)));
  const t1 = Math.min(len, Math.max(tc + s0 * (td - tc), tc + s1 * (td - tc)));
  if (t1 - t0 < minLen) return null;
  const t = (t0 + t1) / 2;
  return [ax + ux * t, ay + uy * t];
}

function polysOverlap(P, Q, shared, p, s, margin) {
  const tol = (OVERLAP_DIST * margin) / s, minLen = OVERLAP_MIN_LEN / margin / s, disc = (R + OVERLAP_DIST) / s;
  for (let i = 0; i + 3 < P.length; i += 2) {
    for (let j = 0; j + 3 < Q.length; j += 2) {
      const mid = segOverlap(P[i], P[i + 1], P[i + 2], P[i + 3], Q[j], Q[j + 1], Q[j + 2], Q[j + 3], tol, minLen);
      if (!mid) continue;
      // Edges always meet inside the disc of a vertex they share.
      if (shared.some(v => Math.hypot(mid[0] - p[2 * v], mid[1] - p[2 * v + 1]) < disc)) continue;
      return true;
    }
  }
  return false;
}

// Number of edge pairs that lie on top of each other somewhere.
// margin > 1 makes the test stricter (see OVERLAP_MARGIN).
export function countOverlaps(L, margin = 1) {
  const { edges, polys, boxes, p } = L;
  const s = fitScale(L);
  let count = 0;
  for (let i = 0; i < L.m; i++) {
    for (let j = i + 1; j < L.m; j++) {
      if (!boxesMeet(boxes, i, j, (OVERLAP_DIST * margin) / s)) continue;
      const a = edges[i], b = edges[j];
      const shared = [a.a, a.b].filter((v, k, xs) => (v === b.a || v === b.b) && xs.indexOf(v) === k);
      if (polysOverlap(polys[i], polys[j], shared, p, s, margin)) count++;
    }
  }
  return count;
}

// Intersections between two polylines, ignoring any within R of (sx, sy):
// edges that share a vertex always meet there.
function polyCrossings(P, Q, sx, sy) {
  let count = 0;
  for (let i = 0; i + 3 < P.length; i += 2) {
    for (let j = 0; j + 3 < Q.length; j += 2) {
      const t = segHit(P[i], P[i + 1], P[i + 2], P[i + 3], Q[j], Q[j + 1], Q[j + 2], Q[j + 3]);
      if (t < 0) continue;
      const x = P[i] + t * (P[i + 2] - P[i]), y = P[i + 1] + t * (P[i + 3] - P[i + 1]);
      if (Math.hypot(x - sx, y - sy) > R) count++;
    }
  }
  return count;
}

// Direction an edge's drawing leaves vertex v (index), sampled past the disc.
function leaveAngle(L, k, v) {
  const P = L.polys[k];
  const fromStart = L.edges[k].a === v;
  const vx = L.p[2 * v], vy = L.p[2 * v + 1];
  const pts = P.length / 2;
  for (let s = 1; s < pts; s++) {
    const i = 2 * (fromStart ? s : pts - 1 - s);
    if (Math.hypot(P[i] - vx, P[i + 1] - vy) >= R || s === pts - 1) {
      return Math.atan2(P[i + 1] - vy, P[i] - vx);
    }
  }
  return 0;
}

export function countCrossings(L) {
  const { edges, polys, boxes, p } = L;
  let count = 0;
  for (let i = 0; i < L.m; i++) {
    for (let j = i + 1; j < L.m; j++) {
      const a = edges[i], b = edges[j];
      const sharedA = a.a === b.a || a.a === b.b, sharedB = a.b === b.a || a.b === b.b;
      // Antiparallel pairs are kept apart by the layout constraints instead.
      if (sharedA && sharedB && !a.loop && !b.loop) continue;
      if (!boxesMeet(boxes, i, j, 1)) continue;
      const s = sharedA ? a.a : sharedB ? a.b : -1;
      if (s >= 0 && !a.loop && !b.loop) {
        let diff = Math.abs(leaveAngle(L, i, s) - leaveAngle(L, j, s));
        diff = Math.min(diff, 2 * Math.PI - diff);
        if (diff < OVERLAP_ANGLE) { count++; continue; }
      }
      count += polyCrossings(polys[i], polys[j], s >= 0 ? p[2 * s] : Infinity, s >= 0 ? p[2 * s + 1] : Infinity);
    }
  }
  return count;
}

export function countVertexHits(L) {
  const { p, edges, polys, boxes } = L;
  let count = 0;
  for (let v = 0; v < L.n; v++) {
    const x = p[2 * v], y = p[2 * v + 1];
    for (let k = 0; k < L.m; k++) {
      if (edges[k].a === v || edges[k].b === v) continue;
      if (x < boxes[4 * k] - CLEARANCE || x > boxes[4 * k + 2] + CLEARANCE
        || y < boxes[4 * k + 1] - CLEARANCE || y > boxes[4 * k + 3] + CLEARANCE) continue;
      if (polyDist(x, y, polys[k]) < CLEARANCE) count++;
    }
  }
  return count;
}

// The coarsest square grid (anchored at the layout's top-left vertex extent)
// that puts every vertex on a grid point. Scored by how many cells it takes
// across plus how far vertices sit from their nearest grid point.
export function bestGrid(L) {
  const { n, p } = L;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, p[2 * i]); x1 = Math.max(x1, p[2 * i]);
    y0 = Math.min(y0, p[2 * i + 1]); y1 = Math.max(y1, p[2 * i + 1]);
  }
  const span = Math.max(x1 - x0, y1 - y0);
  const maxCells = Math.max(16, 3 * Math.ceil(Math.sqrt(n)));
  let best = { cost: 0, x0, y0, u: span || 1 };
  if (n < 2 || span < 1) return best;
  best.cost = Infinity;
  for (let k = 1; k <= maxCells; k++) {
    const u = span / k;
    let off = 0;
    for (let i = 0; i < n; i++) {
      const fx = (p[2 * i] - x0) / u, fy = (p[2 * i + 1] - y0) / u;
      off += Math.hypot(fx - Math.round(fx), fy - Math.round(fy));
    }
    const cost = (k / maxCells + 3 * (off / n)) / (1 + 3 * Math.SQRT1_2);
    if (cost < best.cost) best = { cost, x0, y0, u };
  }
  return best;
}

export const HEURISTICS = [
  {
    id: 'vertexEdge',
    name: "Vertices don't cross edges",
    cost: L => countVertexHits(L) / Math.max(1, L.n),
  },
  {
    id: 'crossings',
    name: 'Minimize crossings',
    cost: L => countCrossings(L) / Math.max(1, L.m),
  },
  {
    id: 'straight',
    name: 'Maximize straight edges',
    cost(L) {
      let curved = 0, total = 0;
      for (let k = 0; k < L.m; k++) {
        if (L.edges[k].loop) continue;
        total++;
        curved += L.curved[k];
      }
      return curved / Math.max(1, total);
    },
  },
  {
    id: 'edgeLength',
    name: 'Edge length variance',
    // Weighted graphs aim for length proportional to weight.
    cost({ p, edges, weighted }) {
      return Math.min(1, cv2(edges.filter(e => !e.loop).map(({ a, b, w }) => {
        const len = Math.hypot(p[2 * a] - p[2 * b], p[2 * a + 1] - p[2 * b + 1]);
        return weighted && w > 0 ? len / w : len;
      })));
    },
  },
  {
    id: 'density',
    name: 'Vertex density variance',
    // Spread of nearest-neighbour distances: even spacing scores 0.
    cost({ p, n }) {
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
    id: 'area',
    name: 'Graph area',
    cost({ p, n }) {
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
    id: 'center',
    name: 'Distance from center',
    // Mean distance of the vertices from the origin, the middle of the canvas.
    cost({ p, n }) {
      if (n === 0) return 0;
      let s = 0;
      for (let i = 0; i < n; i++) s += Math.hypot(p[2 * i] - W / 2, p[2 * i + 1] - H / 2);
      return s / n / Math.hypot(W / 2, H / 2);
    },
  },
  {
    id: 'grid',
    name: 'Vertices on the grid',
    cost: L => bestGrid(L).cost,
  },
];

export const BY_ID = Object.fromEntries(HEURISTICS.map(h => [h.id, h]));

// Hard constraints, always applied: vertices keep their distance and
// antiparallel edges don't sit on top of each other. Without this, "area"
// would collapse the graph to a point.
export function penalty({ n, p, pairs, bend }) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(p[2 * i] - p[2 * j], p[2 * i + 1] - p[2 * j + 1]);
      if (d < MIN_VERTEX_GAP) s += ((MIN_VERTEX_GAP - d) / MIN_VERTEX_GAP) ** 2;
    }
  }
  // Reversed edges bend in mirrored frames, so they coincide when bends sum to 0.
  for (const [k1, k2] of pairs) {
    const sep = Math.abs(bend[k1] + bend[k2]);
    if (sep < MIN_PAIR_SEPARATION) s += ((MIN_PAIR_SEPARATION - sep) / MIN_PAIR_SEPARATION) ** 2;
  }
  return s;
}

export function evaluate(graph) {
  const L = buildLayout(graph, { keepCtrl: true });
  return Object.fromEntries(HEURISTICS.map(h => [h.id, h.cost(L)]));
}
