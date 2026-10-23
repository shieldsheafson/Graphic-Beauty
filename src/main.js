import { createGraph, cloneGraph } from './graph.js';
import { renderGraph, edgeControls } from './render.js';
import { createEditor } from './editor.js';
import { HEURISTICS, evaluate } from './heuristics.js';
import { optimize, animate } from './optimizer.js';
import { PRESETS } from './presets.js';
import { EXAMPLE_NAMES, buildExample } from './examples.js';

const $ = sel => document.querySelector(sel);
const leftSvg = $('#editor');
const rightSvg = $('#result');
const list = $('#heuristics');
const status = $('#status');
const MOVE_MS = 1200;

const state = { graph: createGraph(), selection: null };
let copy = cloneGraph(state.graph);
let run = null;

const editor = createEditor(leftSvg, state, syncCopy);

// ---- right pane -----------------------------------------------------------

function stopRun() {
  run?.cancel();
  run = null;
  $('#beautify').disabled = false;
}

function syncCopy() {
  stopRun();
  copy = cloneGraph(state.graph);
  renderRight();
  status.textContent = 'A copy of your graph. Press Beautify to rearrange it.';
}

function renderRight() {
  renderGraph(rightSvg, copy);
  const values = evaluate(copy);
  for (const li of list.children) {
    li.querySelector('.value').textContent = values[li.dataset.id].toFixed(3);
  }
}

$('#beautify').addEventListener('click', () => {
  stopRun();
  const order = [...list.children].filter(li => li.querySelector('input').checked).map(li => li.dataset.id);
  if (!copy.vertices.length) {
    status.textContent = 'Draw a graph on the left first.';
    return;
  }
  status.textContent = 'Optimizing… 0%';
  $('#beautify').disabled = true;
  run = optimize(copy, order, PRESETS[$('#preset').value], {
    onProgress(t) { status.textContent = `Optimizing… ${Math.round(t * 100)}%`; },
    onDone(best) {
      status.textContent = 'Moving to the new layout…';
      run = animateTo(best, () => {
        run = null;
        $('#beautify').disabled = false;
        status.textContent = 'Done. Press Beautify again to keep refining from here.';
      });
    },
  });
});

const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

// Glide vertices to `best`, while edge curves relax into their default shape
// at the new positions.
function animateTo(best, onDone) {
  const fromV = copy.vertices.map(v => ({ x: v.x, y: v.y }));
  const toV = copy.vertices.map((_, i) => ({ x: best[2 * i], y: best[2 * i + 1] }));
  const fromC = copy.edges.map(e => edgeControls(copy, e).slice(1, 3).map(c => ({ ...c })));

  copy.vertices.forEach((v, i) => Object.assign(v, toV[i]));
  for (const e of copy.edges) e.ctrl = null;
  const toC = copy.edges.map(e => edgeControls(copy, e).slice(1, 3).map(c => ({ ...c })));

  return animate(MOVE_MS, k => {
    copy.vertices.forEach((v, i) => Object.assign(v, lerp(fromV[i], toV[i], k)));
    copy.edges.forEach((e, i) => { e.ctrl = [0, 1].map(j => lerp(fromC[i][j], toC[i][j], k)); });
    renderRight();
  }, () => {
    for (const e of copy.edges) e.ctrl = null;
    renderRight();
    onDone();
  });
}

// ---- toolbar --------------------------------------------------------------

for (const name of ['directed', 'weighted']) {
  for (const input of document.querySelectorAll(`input[name=${name}]`)) {
    input.addEventListener('change', () => {
      state.graph[name] = input.value === '1';
      editor.render();
      syncCopy();
    });
  }
}

const presetSel = $('#preset');
for (const [key, p] of Object.entries(PRESETS)) {
  presetSel.add(new Option(p.comingSoon ? `${p.name} (coming soon)` : p.name, key));
  if (p.comingSoon) presetSel.options[presetSel.options.length - 1].disabled = true;
}

const exampleSel = $('#example');
exampleSel.add(new Option('Load…', ''));
for (const [key, name] of Object.entries(EXAMPLE_NAMES)) exampleSel.add(new Option(name, key));
exampleSel.addEventListener('change', () => {
  if (!exampleSel.value) return;
  state.graph = buildExample(exampleSel.value, state.graph);
  editor.select(null);
  exampleSel.value = '';
  editor.render();
  syncCopy();
});

$('#delete').addEventListener('click', () => editor.deleteSelection());
$('#clear').addEventListener('click', () => {
  state.graph = createGraph(state.graph);
  editor.select(null);
  editor.render();
  syncCopy();
});

// ---- reorderable heuristic list -------------------------------------------

function renumber() {
  [...list.children].forEach((li, i) => { li.querySelector('.rank').textContent = i + 1; });
}

for (const h of HEURISTICS) {
  const li = document.createElement('li');
  li.draggable = true;
  li.dataset.id = h.id;
  li.innerHTML = `<span class="rank"></span>
    <input type="checkbox" checked aria-label="Use ${h.name}">
    <span class="name">${h.name}</span>
    <span class="value" title="Current score (lower is better)"></span>
    <button class="move" type="button" data-dir="-1" aria-label="Move up">▲</button>
    <button class="move" type="button" data-dir="1" aria-label="Move down">▼</button>`;
  li.querySelector('input').addEventListener('change', e => li.classList.toggle('off', !e.target.checked));
  list.append(li);
}
renumber();

list.addEventListener('click', e => {
  const btn = e.target.closest('.move');
  if (!btn) return;
  const li = btn.closest('li');
  if (btn.dataset.dir === '-1') li.previousElementSibling?.before(li);
  else li.nextElementSibling?.after(li);
  renumber();
});

let dragged = null;
list.addEventListener('dragstart', e => {
  dragged = e.target.closest('li');
  dragged.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
list.addEventListener('dragend', () => {
  dragged?.classList.remove('dragging');
  dragged = null;
  renumber();
});
list.addEventListener('dragover', e => {
  if (!dragged) return;
  e.preventDefault();
  const over = e.target.closest('li');
  if (!over || over === dragged) return;
  const r = over.getBoundingClientRect();
  if (e.clientY < r.top + r.height / 2) over.before(dragged); else over.after(dragged);
});

editor.render();
syncCopy();
