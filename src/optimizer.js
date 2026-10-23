import { BY_ID, penalty, buildContext } from './heuristics.js';
import { W, H, GRID, MARGIN } from './graph.js';

// Each step down the priority list is worth this fraction of the one above.
const DECAY = 0.3;
const PENALTY_WEIGHT = 10;
const DURATION_MS = 3000; // total compute time spent annealing
const CHUNK_MS = 40; // work per slice, yielding to the UI in between

function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

// Simulated annealing on vertex positions, scored by the ordered heuristics.
// Runs in slices off the UI's critical path and finishes with
// onDone(bestPositions, bestCost); it never touches the graph itself.
export function optimize(graph, order, preset, { onProgress, onDone }) {
  const { p, ctx } = buildContext(graph);
  const n = ctx.n;
  const hs = order.map(id => BY_ID[id]);
  const ws = hs.map((_, rank) => DECAY ** rank);
  const useGrid = order.includes('grid');

  const cost = q => {
    let c = PENALTY_WEIGHT * penalty(q, ctx);
    for (let k = 0; k < hs.length; k++) c += ws[k] * hs[k].cost(q, ctx);
    return c;
  };
  const clampX = x => Math.min(W - MARGIN, Math.max(MARGIN, x));
  const clampY = y => Math.min(H - MARGIN, Math.max(MARGIN, y));

  let cur = cost(p);
  const best = p.slice();
  let bestCost = cur;

  // Starting temperature from the typical size of a random move.
  let sum = 0;
  const samples = n ? 30 : 0;
  for (let s = 0; s < samples; s++) {
    const i = (Math.random() * n) | 0, ox = p[2 * i], oy = p[2 * i + 1];
    p[2 * i] = clampX(ox + gauss() * 100);
    p[2 * i + 1] = clampY(oy + gauss() * 100);
    sum += Math.abs(cost(p) - cur);
    p[2 * i] = ox; p[2 * i + 1] = oy;
  }
  const T0 = sum / Math.max(1, samples) || 1e-3;
  const Tend = T0 * 1e-4;

  const accept = (c, T) => {
    if (c - cur <= 0 || Math.random() < Math.exp(-(c - cur) / T)) {
      cur = c;
      if (c < bestCost) { bestCost = c; best.set(p); }
      return true;
    }
    return false;
  };

  // Shift the whole layout; single-vertex moves can't recenter a graph.
  const saved = p.slice();
  function translateStep(T, radius) {
    let dx = gauss() * radius, dy = gauss() * radius;
    if (useGrid && Math.random() < 0.5) {
      dx = Math.round(dx / GRID) * GRID;
      dy = Math.round(dy / GRID) * GRID;
    }
    for (let k = 0; k < n; k++) {
      const x = p[2 * k] + dx, y = p[2 * k + 1] + dy;
      if (x !== clampX(x) || y !== clampY(y)) return;
    }
    saved.set(p);
    for (let k = 0; k < n; k++) { p[2 * k] += dx; p[2 * k + 1] += dy; }
    if (!accept(cost(p), T)) p.set(saved);
  }

  function step(t) {
    const T = T0 * (Tend / T0) ** t;
    const radius = 5 + 195 * (1 - t);
    if (n > 1 && Math.random() < 0.05) {
      translateStep(T, radius);
      return;
    }
    const i = (Math.random() * n) | 0, ox = p[2 * i], oy = p[2 * i + 1];
    let x, y;
    if (Math.random() < 0.1 * (1 - t)) {
      x = MARGIN + Math.random() * (W - 2 * MARGIN);
      y = MARGIN + Math.random() * (H - 2 * MARGIN);
    } else {
      x = ox + gauss() * radius;
      y = oy + gauss() * radius;
    }
    if (useGrid && Math.random() < 0.3) {
      x = Math.round(x / GRID) * GRID;
      y = Math.round(y / GRID) * GRID;
    }
    p[2 * i] = clampX(x);
    p[2 * i + 1] = clampY(y);
    preset?.constrain?.(p, i, ctx);

    if (!accept(cost(p), T)) { p[2 * i] = ox; p[2 * i + 1] = oy; }
  }

  // The schedule runs on accumulated compute time rather than wall time, so a
  // throttled background tab yields the same quality, just later.
  let computed = 0;
  let timer = 0;

  function chunk() {
    const begin = performance.now();
    const t = Math.min(1, computed / DURATION_MS);
    if (t < 1 && n > 0) {
      while (performance.now() - begin < CHUNK_MS) {
        const tt = Math.min(1, (computed + performance.now() - begin) / DURATION_MS);
        for (let k = 0; k < 20; k++) step(tt);
      }
      computed += performance.now() - begin;
      onProgress?.(Math.min(1, computed / DURATION_MS));
      timer = setTimeout(chunk, 0);
    } else {
      onDone(best, bestCost);
    }
  }
  timer = setTimeout(chunk, 0);

  return { cancel: () => clearTimeout(timer) };
}

const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Calls onFrame(k) with an eased 0→1 progress over `ms`, then onDone().
export function animate(ms, onFrame, onDone) {
  const start = performance.now();
  let raf = 0;
  function frame() {
    const t = Math.min(1, (performance.now() - start) / ms);
    onFrame(easeInOutCubic(t));
    if (t < 1) raf = requestAnimationFrame(frame);
    else onDone();
  }
  raf = requestAnimationFrame(frame);
  return { cancel: () => cancelAnimationFrame(raf) };
}
