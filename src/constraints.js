import { R } from './geometry.js';
import { countOverlaps, countVertexHits, spacingShortfall } from './heuristics.js';
import { fitScale } from './layout.js';

// "Never allowed" rules. Unlike priorities they aren't traded off: both
// methods treat any violation as worse than any score. Each can be switched
// off or given a different distance under Advanced settings. Distances are
// screen pixels at the size the graph is shown (fitted to the pane).
export const CONSTRAINTS = [
  { id: 'overlaps', name: 'Overlapping edges', px: 4, label: 'edges closer than' },
  { id: 'vertexHits', name: 'Edges through vertices', px: 6, label: 'edge closer to a vertex than' },
  { id: 'spacing', name: 'Vertices too close', px: 30, label: 'vertices closer than' },
];

export const defaultConstraints = () =>
  Object.fromEntries(CONSTRAINTS.map(c => [c.id, { on: true, px: c.px }]));

// Optimizers test overlaps and edge clearance with this much extra slack, so
// nothing they accept sits right at the threshold of the final check.
export const SAFETY_MARGIN = 1.5;

// Each rule's violation for layout L under settings `cs`: 0 means allowed.
export function violationsByRule(L, cs, margin = 1) {
  const scale = fitScale(L);
  const out = {};
  if (cs.overlaps.on) out.overlaps = countOverlaps(L, cs.overlaps.px, margin, scale);
  if (cs.vertexHits.on) out.vertexHits = countVertexHits(L, (R + cs.vertexHits.px * margin) / scale);
  // Spacing must hold both in the layout (so "Graph area" can't shrink the
  // whole graph away) and on screen.
  if (cs.spacing.on) out.spacing = spacingShortfall(L, (2 * R + cs.spacing.px) / Math.min(1, scale));
  return out;
}

export function violations(L, cs, margin = 1) {
  return Object.values(violationsByRule(L, cs, margin)).reduce((a, b) => a + b, 0);
}

// Names of the rules a layout breaks, for telling the user.
export function brokenRules(L, cs) {
  const v = violationsByRule(L, cs);
  return CONSTRAINTS.filter(c => v[c.id] > 1e-9).map(c => c.name.toLowerCase());
}
