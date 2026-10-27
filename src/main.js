import { createGraph, cloneGraph, serializeGraph, parseGraph, W, H } from './graph.js';
import { renderGraph, edgeControls } from './render.js';
import { createEditor } from './editor.js';
import { HEURISTICS, evaluate } from './heuristics.js';
import { CONSTRAINTS, defaultConstraints, violations, brokenRules } from './constraints.js';
import { buildLayout, fitLayout, placeOnCircle, updatePolys } from './layout.js';
import { optimizeAnneal, animate } from './optimizer.js';
import { optimizeStrict } from './strict.js';
import { PRESETS } from './presets.js';
import { EXAMPLE_NAMES, buildExample } from './examples.js';

const $ = sel => document.querySelector(sel);
const leftSvg = $('#editor');
const rightSvg = $('#result');
const list = $('#heuristics');
const status = $('#status');
const scaleInput = $('#scale');
const MOVE_MS = 1200;
const ALGORITHMS = { anneal: optimizeAnneal, strict: optimizeStrict };

const state = { graph: createGraph(), selection: null };

// The right pane mirrors your graph until it is beautified; after that it
// keeps its layout, and edits on the left only mark it out of date.
let copy = cloneGraph(state.graph);
let base = null; // copy's positions and curves at 100% scale
let beautified = false;
let stale = false;
let run = null;

const editor = createEditor(leftSvg, state, onLeftEdit);

// ---- right pane -----------------------------------------------------------

function stopRun() {
  run?.cancel();
  run = null;
  $('#beautify').disabled = false;
  scaleInput.disabled = false;
}

function snapshot(g) {
  return {
    pos: g.vertices.map(v => ({ x: v.x, y: v.y })),
    ctrl: g.edges.map(e => e.ctrl && e.ctrl.map(c => ({ ...c }))),
  };
}

function setScaleLabel() {
  $('#scale-value').textContent = `${scaleInput.value}%`;
}

function copyFromLeft(message = 'A copy of your graph. Press Beautify to rearrange it.') {
  stopRun();
  copy = cloneGraph(state.graph);
  base = snapshot(copy);
  scaleInput.value = 100;
  setScaleLabel();
  beautified = false;
  stale = false;
  renderRight();
  status.textContent = message;
}

function onLeftEdit() {
  if (!beautified) {
    copyFromLeft();
  } else if (!stale) {
    stale = true;
    status.textContent = 'Your graph has changed. Beautify starts from the new version; '
      + '"Copy from your graph" shows it here as is.';
  }
}

function renderRight() {
  renderGraph(rightSvg, copy, { grid: false });
  const values = evaluate(copy);
  for (const li of list.children) {
    li.querySelector('.value').textContent = values[li.dataset.id].toFixed(3);
  }
}

// Scale about the canvas centre, relative to `base`.
const scaled = (q, s) => ({ x: W / 2 + (q.x - W / 2) * s, y: H / 2 + (q.y - H / 2) * s });

function applyScale() {
  const s = scaleInput.value / 100;
  copy.vertices.forEach((v, i) => Object.assign(v, scaled(base.pos[i], s)));
  copy.edges.forEach((e, i) => { e.ctrl = base.ctrl[i] && base.ctrl[i].map(c => scaled(c, s)); });
  renderRight();
}

scaleInput.addEventListener('input', () => {
  setScaleLabel();
  if (!run) applyScale();
});

$('#beautify').addEventListener('click', () => {
  stopRun();
  if (stale || !beautified) copyFromLeft();
  const order = [...list.children].filter(li => li.querySelector('input').checked).map(li => li.dataset.id);
  if (!copy.vertices.length) {
    status.textContent = 'Draw a graph on the left first.';
    return;
  }
  beautified = true;
  status.textContent = 'Optimizing… 0%';
  $('#beautify').disabled = true;
  scaleInput.disabled = true;
  const cs = readConstraints();
  run = ALGORITHMS[$('#algorithm').value](copy, order, PRESETS[$('#preset').value], cs, {
    onProgress(t) { status.textContent = `Optimizing… ${Math.round(t * 100)}%`; },
    onDone(result) {
      status.textContent = 'Moving to the new layout…';
      const broken = [];
      run = animateTo(result, cs, broken, () => {
        stopRun();
        status.textContent = broken.length
          ? `Done, but no layout was found without ${broken.join(' or ')}. Try Beautify again or relax Advanced settings.`
          : 'Done. Press Beautify again to try another layout.';
      });
    },
  });
});

const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

// Fit the result to the canvas, then glide vertices there while every edge
// morphs from its current shape into its new one. Any "never allowed" rule
// the final layout still breaks is pushed onto `broken`.
function animateTo(result, cs, broken, onDone) {
  const L = buildLayout(copy);
  L.p.set(result.p);
  L.bend.set(result.bend);
  fitLayout(L);
  // The optimizers already respect the never-allowed rules; this is the last
  // line of defence, measured exactly as shown.
  const resultBroken = violations(L, cs);
  if (resultBroken) {
    const p = L.p.slice(), bend = L.bend.slice();
    placeOnCircle(L);
    fitLayout(L);
    if (violations(L, cs) >= resultBroken) { L.p.set(p); L.bend.set(bend); updatePolys(L); }
    broken.push(...brokenRules(L, cs));
  }

  const s = scaleInput.value / 100;
  base = { pos: copy.vertices.map((_, i) => ({ x: L.p[2 * i], y: L.p[2 * i + 1] })), ctrl: copy.edges.map(() => null) };
  const fromV = copy.vertices.map(v => ({ x: v.x, y: v.y }));
  const toV = base.pos.map(q => scaled(q, s));
  const fromC = copy.edges.map(e => edgeControls(copy, e).slice(1, 3));

  copy.vertices.forEach((v, i) => Object.assign(v, toV[i]));
  copy.edges.forEach((e, k) => { e.ctrl = null; e.bend = e.u === e.v ? null : L.bend[k]; });
  const toC = copy.edges.map(e => edgeControls(copy, e).slice(1, 3));

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

$('#to-right').addEventListener('click', () => copyFromLeft('Copied from your graph.'));
$('#to-left').addEventListener('click', () => {
  stopRun();
  state.graph = cloneGraph(copy);
  editor.select(null);
  editor.render();
  stale = false;
  status.textContent = 'Copied to your graph.';
});

// ---- import / export ------------------------------------------------------

$('#export').addEventListener('click', () => {
  const blob = new Blob([serializeGraph(state.graph)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'graph.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    loadGraph(parseGraph(await file.text()));
    status.textContent = `Imported ${file.name}.`;
  } catch (err) {
    status.textContent = `Couldn't import ${file.name}: ${err.message}`;
  }
});

function loadGraph(g) {
  state.graph = g;
  for (const name of ['directed', 'weighted']) {
    document.querySelector(`input[name=${name}][value="${g[name] ? 1 : 0}"]`).checked = true;
  }
  editor.select(null);
  editor.render();
  copyFromLeft();
}

// ---- toolbar --------------------------------------------------------------

for (const name of ['directed', 'weighted']) {
  for (const input of document.querySelectorAll(`input[name=${name}]`)) {
    input.addEventListener('change', () => {
      state.graph[name] = input.value === '1';
      editor.render();
      copyFromLeft();
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
  loadGraph(buildExample(exampleSel.value, state.graph));
  exampleSel.value = '';
});

$('#delete').addEventListener('click', () => editor.deleteSelection());
$('#clear').addEventListener('click', () => loadGraph(createGraph(state.graph)));

// ---- advanced settings: never-allowed rules --------------------------------

const constraintsBox = $('#constraints');
const defaults = defaultConstraints();
for (const c of CONSTRAINTS) {
  const row = document.createElement('div');
  row.className = 'constraint';
  row.innerHTML = `<input type="checkbox" id="c-${c.id}" checked>
    <label class="name" for="c-${c.id}">${c.name}</label>
    <label class="detail">${c.label}
      <input type="number" id="c-${c.id}-px" min="0" max="200" step="1" value="${defaults[c.id].px}"> px</label>`;
  row.querySelector('[type=checkbox]').addEventListener('change', e => row.classList.toggle('off', !e.target.checked));
  constraintsBox.append(row);
}

function readConstraints() {
  return Object.fromEntries(CONSTRAINTS.map(c => {
    const px = parseFloat($(`#c-${c.id}-px`).value);
    return [c.id, { on: $(`#c-${c.id}`).checked, px: Number.isFinite(px) && px >= 0 ? px : c.px }];
  }));
}

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
copyFromLeft();
