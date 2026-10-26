// Edge shapes, shared by the renderer and the scoring code so that what is
// scored is exactly what is drawn. Every edge is a cubic bezier [p0, c1, c2, p3].

export const R = 20; // vertex radius

const LOOP_SPREAD = 0.55; // half-angle between a loop's two control points (radians)
const LOOP_MIN = 70; // smallest loop, as control-point distance
const LOOP_SCALE = 0.45; // loop size relative to the vertex's mean edge length

export function bezierPoint([p0, p1, p2, p3], t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function splitCubic(c, t) {
  const [p0, p1, p2, p3] = c;
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), d = lerp(p2, p3, t);
  const e = lerp(a, b, t), g = lerp(b, d, t), m = lerp(e, g, t);
  return [[p0, a, e, m], [m, g, d, p3]];
}

// A bend of 0 is a straight edge; otherwise both control points are pushed
// sideways by `bend` × the edge's length (positive = left of a→b in screen space).
export function bendControls(ax, ay, bx, by, bend) {
  const dx = bx - ax, dy = by - ay;
  const nx = -dy * bend, ny = dx * bend;
  return [
    { x: ax, y: ay },
    { x: ax + dx / 3 + nx, y: ay + dy / 3 + ny },
    { x: ax + (2 * dx) / 3 + nx, y: ay + (2 * dy) / 3 + ny },
    { x: bx, y: by },
  ];
}

// A self-loop points into the widest gap between the vertex's other edges and
// grows with their length, so it stays proportionate when the graph is scaled.
export function loopFrame(x, y, neighbors) {
  if (!neighbors.length) return { angle: -Math.PI / 2, size: LOOP_MIN };
  const angles = neighbors.map(q => Math.atan2(q.y - y, q.x - x)).sort((a, b) => a - b);
  let widest = -1, angle = 0;
  for (let i = 0; i < angles.length; i++) {
    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
    if (next - angles[i] > widest) {
      widest = next - angles[i];
      angle = angles[i] + widest / 2;
    }
  }
  const mean = neighbors.reduce((s, q) => s + Math.hypot(q.x - x, q.y - y), 0) / neighbors.length;
  return { angle, size: Math.max(LOOP_MIN, LOOP_SCALE * mean) };
}

export function loopControls(x, y, angle, size) {
  return [
    { x, y },
    { x: x + size * Math.cos(angle - LOOP_SPREAD), y: y + size * Math.sin(angle - LOOP_SPREAD) },
    { x: x + size * Math.cos(angle + LOOP_SPREAD), y: y + size * Math.sin(angle + LOOP_SPREAD) },
    { x, y },
  ];
}

// Polyline approximation [x0, y0, x1, y1, ...] with `segments` pieces.
export function sampleCubic(c, segments) {
  const out = new Float64Array(2 * (segments + 1));
  for (let s = 0; s <= segments; s++) {
    const q = bezierPoint(c, s / segments);
    out[2 * s] = q.x;
    out[2 * s + 1] = q.y;
  }
  return out;
}
