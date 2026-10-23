import { createGraph, addVertex, addEdge, W, H, MARGIN } from './graph.js';

// Sample graphs with scrambled positions, so Beautify has work to do.
const EXAMPLES = {
  k4: { name: 'Complete K4', n: 4, edges: complete(4) },
  k5: { name: 'Complete K5', n: 5, edges: complete(5) },
  cube: {
    name: 'Cube Q3',
    n: 8,
    edges: [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]],
  },
  petersen: {
    name: 'Petersen',
    n: 10,
    edges: [0, 1, 2, 3, 4].flatMap(i => [[i, (i + 1) % 5], [i, i + 5], [i + 5, ((i + 2) % 5) + 5]]),
  },
  tree: {
    name: 'Binary tree',
    n: 7,
    edges: [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]],
  },
};

function complete(n) {
  const e = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) e.push([i, j]);
  return e;
}

export const EXAMPLE_NAMES = Object.fromEntries(Object.entries(EXAMPLES).map(([k, v]) => [k, v.name]));

export function buildExample(key, { directed, weighted }) {
  const ex = EXAMPLES[key];
  const g = createGraph({ directed, weighted });
  const vs = Array.from({ length: ex.n }, () =>
    addVertex(g, MARGIN + Math.random() * (W - 2 * MARGIN), MARGIN + Math.random() * (H - 2 * MARGIN)));
  for (const [a, b] of ex.edges) addEdge(g, vs[a].id, vs[b].id);
  return g;
}
