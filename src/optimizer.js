import { BY_ID, bestGrid } from './heuristics.js';
import { buildLayout, updatePolys, placeOnCircle } from './layout.js';
import { violations, SAFETY_MARGIN } from './constraints.js';
import { W, H, MARGIN } from './graph.js';

// Each step down the priority list is worth this fraction of the one above.
const DECAY = 0.3;
const BEND_REGULARIZER = 1e-3; // keeps unused curvature from drifting when nothing cares
const MAX_BEND = 0.8;
const DURATION_MS = 3000; // total compute time spent annealing
const CHUNK_MS = 40; // work per slice, yielding to the UI in between

function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

export const clampX = x => Math.min(W - MARGIN, Math.max(MARGIN, x));
export const clampY = y => Math.min(H - MARGIN, Math.max(MARGIN, y));

// Runs `work(progressSoFar)` in slices between UI frames until it returns true.
// Progress is tracked as compute time, so a throttled background tab yields
// the same result, just later.
export function runInSlices(work, onProgress, onDone) {
  let computed = 0, timer = 0;
  function slice() {
    const begin = performance.now();
    const finished = work(() => computed + performance.now() - begin, begin + CHUNK_MS);
    computed += performance.now() - begin;
    if (finished) onDone();
    else {
      onProgress?.(computed);
      timer = setTimeout(slice, 0);
    }
  }
  timer = setTimeout(slice, 0);
  return { cancel: () => clearTimeout(timer) };
}

// Simulated annealing on vertex positions and edge bends, scored by a
// weighted sum of the ordered rules. "Never allowed" rules (constraints.js)
// are hard: a move that breaks them more is always rejected, and the result
// is the best layout with the fewest violations. Finishes with onDone({ p, bend }).
export function optimizeAnneal(graph, order, preset, constraints, { onProgress, onDone }) {
  const L = buildLayout(graph);
  const { n, p, bend } = L;
  const bendable = L.edges.map((e, k) => k).filter(k => !L.edges[k].loop);
  const hs = order.map(id => BY_ID[id]);
  const ws = hs.map((_, rank) => DECAY ** rank);
  const useGrid = order.includes('grid');

  const cost = () => {
    let c = 0;
    for (let k = 0; k < hs.length; k++) c += ws[k] * hs[k].cost(L);
    for (const k of bendable) c += BEND_REGULARIZER * Math.abs(bend[k]);
    return c;
  };

  const broken = () => violations(L, constraints, SAFETY_MARGIN);
  let cur = cost();
  let curBroken = broken();
  const bestP = p.slice(), bestBend = bend.slice();
  let bestCost = cur, bestBroken = curBroken;
  const consider = () => {
    if (curBroken < bestBroken - 1e-12 || (Math.abs(curBroken - bestBroken) <= 1e-12 && cur < bestCost)) {
      bestBroken = curBroken; bestCost = cur; bestP.set(p); bestBend.set(bend);
    }
  };
  // If the starting layout breaks a rule, keep the circle layout in hand in
  // case it does better.
  if (curBroken) {
    const start = p.slice(), startBend = bend.slice();
    placeOnCircle(L);
    const circleBroken = broken();
    if (circleBroken < bestBroken) { bestBroken = circleBroken; bestCost = cost(); bestP.set(p); bestBend.set(bend); }
    p.set(start); bend.set(startBend); updatePolys(L);
  }

  const savedP = p.slice(), savedBend = bend.slice();
  const save = () => { savedP.set(p); savedBend.set(bend); };
  const restore = () => { p.set(savedP); bend.set(savedBend); updatePolys(L); };

  // Starting temperature from the typical size of a random move.
  let sum = 0;
  const samples = n ? 30 : 0;
  for (let s = 0; s < samples; s++) {
    save();
    const i = (Math.random() * n) | 0;
    p[2 * i] = clampX(p[2 * i] + gauss() * 100);
    p[2 * i + 1] = clampY(p[2 * i + 1] + gauss() * 100);
    updatePolys(L);
    sum += Math.abs(cost() - cur);
    restore();
  }
  const T0 = sum / Math.max(1, samples) || 1e-3;
  const Tend = T0 * 1e-4;

  function snapToGrid(i) {
    const { x0, y0, u } = bestGrid(L);
    p[2 * i] = clampX(x0 + Math.round((p[2 * i] - x0) / u) * u);
    p[2 * i + 1] = clampY(y0 + Math.round((p[2 * i + 1] - y0) / u) * u);
  }

  function step(t) {
    const T = T0 * (Tend / T0) ** t;
    const radius = 5 + 195 * (1 - t);
    save();
    const r = Math.random();
    if (n > 1 && r < 0.05) {
      // Shift the whole layout; single-vertex moves can't recenter a graph.
      const dx = gauss() * radius, dy = gauss() * radius;
      for (let k = 0; k < n; k++) {
        const x = p[2 * k] + dx, y = p[2 * k + 1] + dy;
        if (x !== clampX(x) || y !== clampY(y)) return;
      }
      for (let k = 0; k < n; k++) { p[2 * k] += dx; p[2 * k + 1] += dy; }
    } else if (bendable.length && r < 0.25) {
      const k = bendable[(Math.random() * bendable.length) | 0];
      bend[k] = Math.random() < 0.3 ? 0 : Math.max(-MAX_BEND, Math.min(MAX_BEND, bend[k] + gauss() * 0.3));
    } else {
      const i = (Math.random() * n) | 0;
      if (Math.random() < 0.1 * (1 - t)) {
        p[2 * i] = MARGIN + Math.random() * (W - 2 * MARGIN);
        p[2 * i + 1] = MARGIN + Math.random() * (H - 2 * MARGIN);
      } else {
        p[2 * i] = clampX(p[2 * i] + gauss() * radius);
        p[2 * i + 1] = clampY(p[2 * i + 1] + gauss() * radius);
      }
      if (useGrid && Math.random() < 0.3) snapToGrid(i);
      preset?.constrain?.(p, i, L);
    }
    updatePolys(L);

    const b = broken();
    if (b > curBroken + 1e-12) { restore(); return; }
    const c = cost();
    if (b < curBroken - 1e-12 || c - cur <= 0 || Math.random() < Math.exp(-(c - cur) / T)) {
      cur = c;
      curBroken = b;
      consider();
    } else {
      restore();
    }
  }

  return runInSlices(
    (elapsed, until) => {
      if (n === 0 || elapsed() >= DURATION_MS) return true;
      while (performance.now() < until) {
        const t = Math.min(1, elapsed() / DURATION_MS);
        for (let k = 0; k < 10; k++) step(t);
      }
      return false;
    },
    ms => onProgress?.(Math.min(1, ms / DURATION_MS)),
    () => onDone({ p: bestP, bend: bestBend }),
  );
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
