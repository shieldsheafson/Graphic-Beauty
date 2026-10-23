// Graph-type presets. A preset may supply constrain(p, i, ctx), called after
// the optimizer moves vertex i, to project that vertex back onto the preset's
// rules (e.g. a tree pinning each level to one height). It may only change
// vertex i, since rejected moves restore just that vertex.

export const PRESETS = {
  general: { name: 'General' },
  tree: { name: 'Tree', comingSoon: true },
  flow: { name: 'Flow network', comingSoon: true },
  bipartite: { name: 'Bipartite', comingSoon: true },
  special: { name: 'Special (wheel, cycle, complete…)', comingSoon: true },
};
