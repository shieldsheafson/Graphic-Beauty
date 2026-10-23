import {
  addVertex, addEdge, getVertex, getEdge, removeVertex, removeEdge, clampToCanvas,
} from './graph.js';
import { R, edgeControls, renderGraph } from './render.js';

const DRAG_THRESHOLD = 4;
const DOUBLE_CLICK_MS = 350;

// Wires mouse + keyboard editing onto the left SVG.
// state = { graph, selection: null | { type: 'vertex' | 'edge', id } }
// onChange(structural) is called after every edit (structural = graph changed).
export function createEditor(svg, state, onChange) {
  let drag = null;
  let lastClick = { id: null, t: 0 };
  let freshText = true; // first keystroke after selecting replaces the label/weight

  const render = () => renderGraph(svg, state.graph, { selection: state.selection, editable: true });

  function select(sel) {
    state.selection = sel;
    freshText = true;
  }

  function toSvg(ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }

  // Move a vertex, carrying the custom bezier handles of incident edges with it.
  function moveVertex(v, dx, dy) {
    const p = clampToCanvas(v.x + dx, v.y + dy, R);
    dx = p.x - v.x;
    dy = p.y - v.y;
    v.x = p.x;
    v.y = p.y;
    for (const e of state.graph.edges) {
      if (!e.ctrl || (e.u !== v.id && e.v !== v.id)) continue;
      const [c1, c2] = e.ctrl;
      const w1 = e.u === e.v ? 1 : (e.u === v.id ? 2 / 3 : 1 / 3);
      const w2 = e.u === e.v ? 1 : 1 - w1;
      c1.x += dx * w1; c1.y += dy * w1;
      c2.x += dx * w2; c2.y += dy * w2;
    }
  }

  svg.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    const p = toSvg(ev);
    const h = ev.target.closest('[data-handle]');
    const vEl = ev.target.closest('[data-vid]');
    const eEl = ev.target.closest('[data-eid]');
    drag = {
      kind: h ? 'handle' : vEl ? 'vertex' : eEl ? 'edge' : 'empty',
      id: vEl ? +vEl.dataset.vid : eEl ? +eEl.dataset.eid : null,
      handle: h ? +h.dataset.handle : null,
      start: p,
      last: p,
      moved: false,
    };
    svg.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    // preventDefault keeps focus where it was; release toolbar controls so typing reaches the graph.
    document.activeElement?.blur();
  });

  svg.addEventListener('pointermove', ev => {
    if (!drag) return;
    const p = toSvg(ev);
    if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const g = state.graph;
    if (drag.kind === 'vertex') {
      moveVertex(getVertex(g, drag.id), p.x - drag.last.x, p.y - drag.last.y);
    } else if (drag.kind === 'handle') {
      const e = getEdge(g, state.selection.id);
      if (!e.ctrl) {
        const [, c1, c2] = edgeControls(g, e);
        e.ctrl = [{ ...c1 }, { ...c2 }];
      }
      e.ctrl[drag.handle] = { x: p.x, y: p.y };
    }
    drag.last = p;
    render();
    onChange(true);
  });

  svg.addEventListener('pointerup', ev => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved) return;
    const g = state.graph;

    if (d.kind === 'vertex') {
      const now = performance.now();
      const isDouble = lastClick.id === d.id && now - lastClick.t < DOUBLE_CLICK_MS;
      lastClick = { id: d.id, t: now };
      const sel = state.selection;
      if (sel && sel.type === 'vertex' && sel.id !== d.id) {
        select({ type: 'edge', id: addEdge(g, sel.id, d.id).id });
        lastClick = { id: null, t: 0 };
      } else if (isDouble) {
        select({ type: 'edge', id: addEdge(g, d.id, d.id).id });
        lastClick = { id: null, t: 0 };
      } else {
        select({ type: 'vertex', id: d.id });
      }
    } else if (d.kind === 'edge') {
      select({ type: 'edge', id: d.id });
    } else if (d.kind === 'empty') {
      if (state.selection) {
        select(null);
      } else {
        const p = clampToCanvas(d.start.x, d.start.y, R);
        addVertex(g, p.x, p.y);
      }
    }
    render();
    onChange(true);
  });

  document.addEventListener('keydown', ev => {
    if (ev.target.closest('input, textarea, select')) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const sel = state.selection;
    if (!sel) return;
    const g = state.graph;

    if (ev.key === 'Escape' || ev.key === 'Enter') {
      select(null);
    } else if (ev.key === 'Delete') {
      deleteSelection();
      return;
    } else if (sel.type === 'vertex') {
      const v = getVertex(g, sel.id);
      if (ev.key === 'Backspace') v.label = v.label.slice(0, -1);
      else if (ev.key.length === 1 && ev.key !== ' ') v.label = freshText ? ev.key : v.label + ev.key;
      else return;
      freshText = false;
    } else if (sel.type === 'edge') {
      if (!g.weighted) return;
      const e = getEdge(g, sel.id);
      if (ev.key === 'Backspace') e.weightText = e.weightText.slice(0, -1);
      else if (/^[0-9.\-]$/.test(ev.key)) e.weightText = freshText ? ev.key : e.weightText + ev.key;
      else return;
      freshText = false;
      const w = parseFloat(e.weightText);
      e.weight = Number.isFinite(w) ? w : 0;
    }
    ev.preventDefault();
    render();
    onChange(true);
  });

  function deleteSelection() {
    const sel = state.selection;
    if (!sel) return;
    if (sel.type === 'vertex') removeVertex(state.graph, sel.id);
    else removeEdge(state.graph, sel.id);
    select(null);
    render();
    onChange(true);
  }

  return { render, deleteSelection, select };
}
