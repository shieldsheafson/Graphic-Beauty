# Graphic Beauty

Draw a graph, then let Graphic Beauty find a prettier layout of the same graph (an isomorph). "Pretty" is subjective, so you rank what matters to you and the layout is optimized in that order.

## Try it

**No install needed:** open `graphic-beauty.html` in any modern browser (double-click it). It's a single self-contained file that works offline.

Don't have that file? Build it from this folder with Node.js:

```bash
node build.mjs
```

That writes `dist/graphic-beauty.html`.

## Using it

**Drawing (left pane)**

- Choose **Undirected / Directed** and **Unweighted / Weighted** at the top.
- Click empty space to add a vertex. Vertices are labelled a, b, c, …
- Click a vertex to highlight it, then click another vertex to connect them. Double-click a vertex to make a loop.
- With a vertex highlighted, type to relabel it. With an edge highlighted (and Weighted on), type to change its weight.
- Click an edge to show two handles, then drag them to curve the edge.
- Drag vertices to move them. Right-click a vertex or edge to delete it (or press Delete, or use **Delete selected**). Esc deselects.
- **Example** loads a few classic graphs (K4, K5, cube, Petersen, binary tree) with scrambled positions.
- **Export** saves your graph as a `.json` file and **Import** loads one back, which is handy for sharing a graph or reporting a layout problem.

**Beautifying (right pane)**

The right pane shows a copy of your graph. In **Priorities**, drag items (or use ▲▼) so the most important are at the top, and untick any you don't care about. Pick a **Method**, then press **Beautify**: it searches for the best layout, then animates the graph into it, scaled to fill the pane. The **Scale** slider shrinks or enlarges the result.

| Priority | Prefers layouts where… |
| --- | --- |
| Vertices don't cross edges | no edge runs through a vertex it doesn't belong to |
| Minimize crossings | as few edges cross as possible (curves, loops and edges overlapping at a shared vertex all count) |
| Maximize straight edges | edges are straight; Beautify may curve an edge, but this rule pushes back |
| Edge length variance | edges are about the same length (in weighted graphs, length tracks weight) |
| Vertex density variance | vertices are evenly spaced |
| Graph area | the graph is compact |
| Distance from center | vertices sit close to the origin, the middle of the canvas |
| Vertices on the grid | vertices fit on the coarsest possible grid, so they line up in rows and columns |

The number beside each priority is the current layout's score (lower is better). Vertices always keep a minimum distance apart, and a pair of opposite directed edges never lies on top of itself.

**Methods**

- **Balanced** weighs all priorities together; each counts 0.3× as much as the one above it.
- **Strict** handles one priority at a time: a better score on a higher priority always wins, however much worse everything below gets. It adds vertices one by one in random order, putting each in the best spot, then keeps re-placing vertices until nothing improves. With a priority that varies smoothly (area, edge length, center) at the top, the ones below rarely get a say.

While the right pane still matches your graph, it follows your edits. Once beautified, it keeps its layout: **Copy from your graph** replaces it with your current drawing, **← Copy to your graph** replaces your drawing with it, and Beautify always starts from your latest edits.

## How it works

Both methods score the edges as they are actually drawn (curves and loops are sampled into short line segments). Balanced uses simulated annealing: many small random moves of vertices, edge bends and occasionally the whole graph, keeping changes that lower the weighted score and sometimes accepting worse ones early on to escape dead ends. Strict compares scores priority by priority instead of adding them up. Each method gets about 3 seconds of computing, then the result is scaled to fill the pane and the graph animates into it. Self-loops point into the widest gap between a vertex's edges and grow with them.

## Development

It's plain HTML, CSS and JavaScript (ES modules) with no dependencies. Because browsers block modules on pages opened from disk, serve the folder while developing:

```bash
python3 -m http.server 8417
```

Then open http://localhost:8417. Run `node build.mjs` to refresh the single-file version after changes.

| File | Role |
| --- | --- |
| `index.html`, `style.css` | page and styles |
| `src/main.js` | wiring: toolbar, priority list, Beautify |
| `src/editor.js` | mouse and keyboard editing |
| `src/render.js` | SVG drawing (curves, arrows, weights) |
| `src/geometry.js` | edge shapes shared by drawing and scoring |
| `src/graph.js` | graph model, JSON import/export |
| `src/layout.js` | fast layout representation, fit-to-pane |
| `src/heuristics.js` | the priority scores |
| `src/optimizer.js` | Balanced (annealing) method and the move animation |
| `src/strict.js` | Strict method |
| `src/presets.js` | placeholder for graph types |
| `src/examples.js` | sample graphs |
| `build.mjs` | bundles everything into one HTML file |

## Roadmap

Graph-type presets with their own rules: trees (levels drawn top to bottom from the root), flow networks, bipartite graphs, and special graphs such as wheels, cycles and complete graphs.

## License

[MIT](LICENSE)
