import { BY_ID } from './heuristics.js';
import { buildLayout, subLayout, updatePolys, placeOnCircle } from './layout.js';
import { violations, SAFETY_MARGIN } from './constraints.js';
import { W, H, MARGIN } from './graph.js';
import { runInSlices, clampX, clampY } from './optimizer.js';

// Strict-priority layout: vertices are added one at a time in random order,
// each placed at the spot that is best for the top rule; lower rules only
// break exact ties. Then vertices are repeatedly re-placed the same way until
// a full pass changes nothing or the time budget runs out. The "never
// allowed" rules (constraints.js) come before every priority, so a spot that
// keeps them always wins.

const STEP = 25; // spacing of the candidate lattice
const REFINE_STEPS = [12, 6, 3];
const BENDS = [0, 0.25, -0.25, 0.5, -0.5];
const REFINE_MS = 3000; // compute time for the re-placement passes
const EPS = 1e-9;
const YIELD_EVERY = 40; // evaluations between checks of the time slice

const LATTICE_X = [], LATTICE_Y = [];
for (let x = MARGIN; x <= W - MARGIN; x += STEP) LATTICE_X.push(x);
for (let y = MARGIN; y <= H - MARGIN; y += STEP) LATTICE_Y.push(y);

// -1 if score a is strictly better than b, comparing rule by rule.
function compare(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - EPS) return -1;
    if (a[i] > b[i] + EPS) return 1;
  }
  return 0;
}

function shuffle(xs) {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

export function optimizeStrict(graph, order, preset, constraints, { onProgress, onDone }) {
  const full = buildLayout(graph);
  const n = full.n;
  const broken = L => violations(L, constraints, SAFETY_MARGIN);
  const rules = [broken, ...order.map(id => BY_ID[id].cost)];
  const score = L => rules.map(f => f(L));

  // Lattice points, plus points sharing a row or column with another vertex
  // so that alignments are reachable.
  function candidates(L, i) {
    const out = [L.p[2 * i], L.p[2 * i + 1]];
    for (const x of LATTICE_X) for (const y of LATTICE_Y) out.push(x, y);
    for (let j = 0; j < L.n; j++) {
      if (j === i) continue;
      for (const y of LATTICE_Y) out.push(L.p[2 * j], y);
      for (const x of LATTICE_X) out.push(x, L.p[2 * j + 1]);
    }
    return out;
  }

  // Moves vertex i of L to its best spot, then picks bends for its edges.
  // Yields now and then so the caller can spread the work over time slices.
  function* place(L, i) {
    const { p } = L;
    updatePolys(L);
    let best = score(L), bx = p[2 * i], by = p[2 * i + 1];
    let evals = 0;
    const tryAt = (x, y) => {
      p[2 * i] = clampX(x);
      p[2 * i + 1] = clampY(y);
      preset?.constrain?.(p, i, L);
      updatePolys(L);
      const s = score(L);
      if (compare(s, best) < 0) { best = s; bx = p[2 * i]; by = p[2 * i + 1]; return true; }
      return false;
    };

    const c = candidates(L, i);
    for (let k = 0; k < c.length; k += 2) {
      tryAt(c[k], c[k + 1]);
      if (++evals % YIELD_EVERY === 0) yield;
    }
    for (const step of REFINE_STEPS) {
      for (let improved = true; improved;) {
        improved = false;
        const cx = bx, cy = by;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          if (tryAt(cx + dx * step, cy + dy * step)) improved = true;
        }
        yield;
      }
    }
    p[2 * i] = bx;
    p[2 * i + 1] = by;

    for (const k of L.incident[i]) {
      if (L.edges[k].loop) continue;
      let chosen = L.bend[k];
      for (const b of BENDS) {
        L.bend[k] = b;
        updatePolys(L);
        const s = score(L);
        if (compare(s, best) < 0) { best = s; chosen = b; }
      }
      L.bend[k] = chosen;
    }
    updatePolys(L);
    yield;
    return best;
  }

  let placed = 0, refining = false, refineStart = 0;
  // The last complete layout; placement mid-search leaves a vertex on a trial spot.
  const resultP = full.p.slice(), resultBend = full.bend.slice();
  const keep = () => { resultP.set(full.p); resultBend.set(full.bend); };

  function* run() {
    // Insertion: grow the graph one vertex at a time.
    const sequence = shuffle([...Array(n).keys()]);
    for (let t = 0; t < n; t++) {
      const S = subLayout(full, sequence.slice(0, t + 1));
      yield* place(S, t);
      for (let i = 0; i <= t; i++) {
        full.p[2 * sequence[i]] = S.p[2 * i];
        full.p[2 * sequence[i] + 1] = S.p[2 * i + 1];
      }
      S.edges.forEach((e, k) => { full.bend[e.src] = S.bend[k]; });
      placed = t + 1;
    }
    // Refinement: take each vertex out and put it back at its best spot.
    refining = true;
    updatePolys(full);
    keep();
    let current = score(full);
    for (;;) {
      let changed = false;
      for (const u of shuffle([...Array(n).keys()])) {
        const after = yield* place(full, u);
        keep();
        if (compare(after, current) < 0) changed = true;
        current = after;
      }
      if (!changed) return;
    }
  }

  const gen = run();
  let done = n === 0;
  return runInSlices(
    (elapsed, until) => {
      if (done) return true;
      while (performance.now() < until) {
        if (refining && !refineStart) refineStart = elapsed();
        if (refining && elapsed() - refineStart >= REFINE_MS) return true;
        if (gen.next().done) return true;
      }
      return false;
    },
    ms => onProgress?.(refining
      ? 0.6 + 0.4 * Math.min(1, (ms - refineStart) / REFINE_MS)
      : 0.6 * (placed / Math.max(1, n))),
    () => {
      full.p.set(resultP);
      full.bend.set(resultBend);
      updatePolys(full);
      const resultBroken = broken(full);
      if (resultBroken) {
        placeOnCircle(full);
        // Keep whichever of the two breaks the rules less.
        if (broken(full) >= resultBroken) { full.p.set(resultP); full.bend.set(resultBend); }
      }
      onDone({ p: full.p, bend: full.bend });
    },
  );
}
