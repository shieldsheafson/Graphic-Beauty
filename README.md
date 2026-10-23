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
- Drag vertices to move them. Esc deselects. Delete (or the **Delete selected** button) removes the highlighted item.
- **Example** loads a few classic graphs (K4, K5, cube, Petersen, binary tree) with scrambled positions.

**Beautifying (right pane)**

The right pane shows a copy of your graph. In **Priorities**, drag items (or use ▲▼) so the most important are at the top, and untick any you don't care about. Then press **Beautify**: it searches for the best layout and then animates the graph into it.

| Priority | Prefers layouts where… |
| --- | --- |
| Graph area | the graph's bounding box is small |
| Edge length variance | edges are about the same length (in weighted graphs, length tracks weight) |
| Vertex density variance | vertices are evenly spaced |
| Distance from center | the graph sits in the middle of the canvas |
| Minimize crossings | as few edges cross as possible |
| Vertices on the grid | vertices land on grid points |

The number beside each priority is the current layout's score (lower is better). Vertices are always kept apart and off edges they don't belong to.

## How it works

Beautify uses simulated annealing. It makes many small random moves of vertices (and occasionally the whole graph), keeping changes that lower a weighted score and sometimes accepting worse ones early on to escape dead ends. Each priority counts 0.3× as much as the one above it. After about 3 seconds of searching, the vertices animate to the best layout found and any curved edges relax straight.

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
| `src/graph.js` | graph model |
| `src/heuristics.js` | the priority scores |
| `src/optimizer.js` | annealing search and the move animation |
| `src/presets.js` | placeholder for graph types |
| `src/examples.js` | sample graphs |
| `build.mjs` | bundles everything into one HTML file |

## Roadmap

Graph-type presets with their own rules: trees (levels drawn top to bottom from the root), flow networks, bipartite graphs, and special graphs such as wheels, cycles and complete graphs.

## License

[MIT](LICENSE)
