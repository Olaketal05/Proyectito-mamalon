'use strict';

/* =========================================================
   Series comerciales
   10 % -> E12      1 % -> E96
   ========================================================= */
const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const E96 = [
  1.00, 1.02, 1.05, 1.07, 1.10, 1.13, 1.15, 1.18, 1.21, 1.24, 1.27, 1.30,
  1.33, 1.37, 1.40, 1.43, 1.47, 1.50, 1.54, 1.58, 1.62, 1.65, 1.69, 1.74,
  1.78, 1.82, 1.87, 1.91, 1.96, 2.00, 2.05, 2.10, 2.15, 2.21, 2.26, 2.32,
  2.37, 2.43, 2.49, 2.55, 2.61, 2.67, 2.74, 2.80, 2.87, 2.94, 3.01, 3.09,
  3.16, 3.24, 3.32, 3.40, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12,
  4.22, 4.32, 4.42, 4.53, 4.64, 4.75, 4.87, 4.99, 5.11, 5.23, 5.36, 5.49,
  5.62, 5.76, 5.90, 6.04, 6.19, 6.34, 6.49, 6.65, 6.81, 6.98, 7.15, 7.32,
  7.50, 7.68, 7.87, 8.06, 8.25, 8.45, 8.66, 8.87, 9.09, 9.31, 9.53, 9.76
];

const KINDS = {
  '1':    { n: 1, name: '1 resistencia' },
  'S2':   { n: 2, name: '2 en serie' },
  'P2':   { n: 2, name: '2 en paralelo' },
  'S3':   { n: 3, name: '3 en serie' },
  'P3':   { n: 3, name: '3 en paralelo' },
  'RS_P': { n: 3, name: 'R + (R ∥ R)' },
  'RP_S': { n: 3, name: 'R ∥ (R + R)' }
};

const MIN_TARGET = 0.1;
const MAX_TARGET = 2e7;

/* =========================================================
   Preparación de datos (se calcula una vez por tolerancia)
   Se precalculan todas las parejas (serie y paralelo) ordenadas,
   así las combinaciones de 3 resistencias se buscan con
   búsqueda binaria en lugar de fuerza bruta.
   ========================================================= */
const dataCache = {};

function sortPairs(v, pi, pj) {
  const m = v.length;
  const idx = new Uint32Array(m);
  for (let k = 0; k < m; k++) idx[k] = k;
  idx.sort((a, b) => v[a] - v[b]);
  const out = { v: new Float64Array(m), i: new Uint16Array(m), j: new Uint16Array(m) };
  for (let k = 0; k < m; k++) {
    const s = idx[k];
    out.v[k] = v[s]; out.i[k] = pi[s]; out.j[k] = pj[s];
  }
  return out;
}

function getData(tol) {
  if (dataCache[tol]) return dataCache[tol];
  const base = tol === 10 ? E12 : E96;
  const list = [];
  for (let e = 0; e <= 6; e++) {
    for (const m of base) list.push(+(m * Math.pow(10, e)).toPrecision(6));
  }
  list.push(1e7);
  const vals = Float64Array.from(list);
  const n = vals.length;
  const m = (n * (n + 1)) / 2;
  const sv = new Float64Array(m), pv = new Float64Array(m);
  const pi = new Uint16Array(m), pj = new Uint16Array(m);
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      sv[k] = vals[i] + vals[j];
      pv[k] = (vals[i] * vals[j]) / (vals[i] + vals[j]);
      pi[k] = i; pj[k] = j; k++;
    }
  }
  return (dataCache[tol] = { vals, S: sortPairs(sv, pi, pj), P: sortPairs(pv, pi, pj) });
}

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/* índices cercanos a x (k a cada lado) */
function near(arr, x, k = 2) {
  const lb = lowerBound(arr, x);
  const out = [];
  for (let t = lb - k; t < lb + k; t++) if (t >= 0 && t < arr.length) out.push(t);
  return out;
}

/* =========================================================
   Búsqueda de combinaciones
   ========================================================= */
function search(target, tol, maxN) {
  const { vals, S, P } = getData(tol);
  const n = vals.length;
  const seen = new Set();
  const out = [];
  const par = (a, b) => (a * b) / (a + b);

  function add(kind, r, value) {
    if (KINDS[kind].n > maxN) return;
    let rs;
    if (kind === 'RS_P' || kind === 'RP_S') {
      rs = [r[0], ...r.slice(1).sort((a, b) => b - a)];
    } else {
      rs = r.slice().sort((a, b) => b - a);
    }
    const key = kind + '|' + rs.join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, r: rs, value, err: ((value - target) / target) * 100 });
  }

  /* 1 resistencia */
  for (const t of near(vals, target, 1)) add('1', [vals[t]], vals[t]);

  /* 2 resistencias */
  if (maxN >= 2) {
    for (let a = 0; a < n; a++) {
      const r1 = vals[a];
      if (r1 < target) {                       // serie: R2 ≈ T - R1
        for (const t of near(vals, target - r1, 1)) add('S2', [r1, vals[t]], r1 + vals[t]);
      } else if (r1 > target) {                // paralelo: R2 ≈ T·R1 / (R1 - T)
        for (const t of near(vals, (target * r1) / (r1 - target), 1)) add('P2', [r1, vals[t]], par(r1, vals[t]));
      }
    }
  }

  /* 3 resistencias */
  if (maxN >= 3) {
    for (let a = 0; a < n; a++) {
      const r1 = vals[a];
      if (r1 < target) {
        const need = target - r1;
        for (const t of near(S.v, need)) add('S3',   [r1, vals[S.i[t]], vals[S.j[t]]], r1 + S.v[t]);
        for (const t of near(P.v, need)) add('RS_P', [r1, vals[P.i[t]], vals[P.j[t]]], r1 + P.v[t]);
      } else if (r1 > target) {
        const need = (target * r1) / (r1 - target);
        for (const t of near(S.v, need)) add('RP_S', [r1, vals[S.i[t]], vals[S.j[t]]], par(r1, S.v[t]));
        for (const t of near(P.v, need)) add('P3',   [r1, vals[P.i[t]], vals[P.j[t]]], par(r1, P.v[t]));
      }
    }
  }

  const rank = c => Math.round(Math.abs(c.err) * 1e9);
  out.sort((x, y) => rank(x) - rank(y) || KINDS[x.kind].n - KINDS[y.kind].n);
  return out;
}

/* =========================================================
   Formato
   ========================================================= */
function fmtShort(v, d = 4) {
  let x = v, u = '';
  if (v >= 1e6) { x = v / 1e6; u = 'M'; }
  else if (v >= 1e3) { x = v / 1e3; u = 'k'; }
  return parseFloat(x.toPrecision(d)) + u;
}
const fmtOhm = (v, d = 4) => fmtShort(v, d) + ' Ω';

function fmtErr(e) {
  if (Math.abs(e) < 5e-7) return 'Exacto';
  return (e >= 0 ? '+' : '') + e.toFixed(Math.abs(e) < 0.1 ? 4 : 3) + ' %';
}
function errClass(e) {
  const a = Math.abs(e);
  return a < 0.1 ? 'good' : a < 1 ? 'ok' : 'warn';
}

/* =========================================================
   Árbol del circuito + expresión
   ========================================================= */
const R  = v => ({ t: 'R', v });
const Sx = (...kids) => ({ t: 'S', kids });
const Px = (...kids) => ({ t: 'P', kids });

function buildTree(c) {
  const r = c.r;
  switch (c.kind) {
    case '1':    return R(r[0]);
    case 'S2':   return Sx(R(r[0]), R(r[1]));
    case 'P2':   return Px(R(r[0]), R(r[1]));
    case 'S3':   return Sx(R(r[0]), R(r[1]), R(r[2]));
    case 'P3':   return Px(R(r[0]), R(r[1]), R(r[2]));
    case 'RS_P': return Sx(R(r[0]), Px(R(r[1]), R(r[2])));
    case 'RP_S': return Px(R(r[0]), Sx(R(r[1]), R(r[2])));
  }
}

function expr(node, parent) {
  if (node.t === 'R') return fmtShort(node.v) + 'Ω';
  const sep = node.t === 'S' ? ' + ' : ' ∥ ';
  const s = node.kids.map(k => expr(k, node.t)).join(sep);
  return parent && parent !== node.t ? '(' + s + ')' : s;
}

/* =========================================================
   Dibujo del circuito (SVG)
   ========================================================= */
const RES_W = 76, RES_H = 44, RES_CY = 26, GAP = 6, BUS = 14;

function measure(n) {
  if (n.t === 'R') { n.w = RES_W; n.h = RES_H; n.cy = RES_CY; return n; }
  n.kids.forEach(measure);
  if (n.t === 'S') {
    n.w = n.kids.reduce((s, k) => s + k.w, 0);
    const up = Math.max(...n.kids.map(k => k.cy));
    const down = Math.max(...n.kids.map(k => k.h - k.cy));
    n.cy = up; n.h = up + down;
  } else {
    n.maxw = Math.max(...n.kids.map(k => k.w));
    n.w = n.maxw + 2 * BUS;
    let y = 0;
    n.kids.forEach(k => { k.top = y; y += k.h + GAP; });
    n.h = y - GAP;
    const first = n.kids[0].top + n.kids[0].cy;
    const last = n.kids[n.kids.length - 1];
    n.cy = (first + last.top + last.cy) / 2;
  }
  return n;
}

const line = (x1, y1, x2, y2) => `<line class="wire" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
const dot = (x, y) => `<circle class="dot" cx="${x}" cy="${y}" r="3.2"/>`;

function draw(n, x, y) {
  if (n.t === 'R') {
    const cy = y + n.cy, x0 = x + 8;
    const z = [[0, 0], [5, -9], [15, 9], [25, -9], [35, 9], [45, -9], [55, 9], [60, 0]]
      .map(([dx, dy]) => `${x0 + dx},${cy + dy}`).join(' ');
    return `${line(x, cy, x0, cy)}<polyline class="res" points="${z}"/>${line(x0 + 60, cy, x + n.w, cy)}` +
           `<text x="${x + n.w / 2}" y="${y + 11}">${fmtShort(n.v)}Ω</text>`;
  }
  if (n.t === 'S') {
    let s = '', cx = x;
    n.kids.forEach(k => { s += draw(k, cx, y + (n.cy - k.cy)); cx += k.w; });
    return s;
  }
  // paralelo
  const lb = x + 7, rb = x + n.w - 7, mid = y + n.cy;
  const cys = n.kids.map(k => y + k.top + k.cy);
  let s = line(x, mid, lb, mid) + line(rb, mid, x + n.w, mid);
  s += line(lb, cys[0], lb, cys[cys.length - 1]) + line(rb, cys[0], rb, cys[cys.length - 1]);
  s += dot(lb, mid) + dot(rb, mid);
  n.kids.forEach((k, i) => {
    const kx = x + BUS + (n.maxw - k.w) / 2, ky = y + k.top;
    s += line(lb, cys[i], kx, cys[i]) + line(kx + k.w, cys[i], rb, cys[i]);
    if (n.kids.length > 2 && i > 0 && i < n.kids.length - 1) s += dot(lb, cys[i]) + dot(rb, cys[i]);
    s += draw(k, kx, ky);
  });
  return s;
}

function circuitSVG(node) {
  measure(node);
  const padX = 12, lead = 16, padY = 8;
  const W = node.w + 2 * (padX + lead), H = node.h + 2 * padY;
  const x0 = padX + lead, cy = padY + node.cy;
  return `<svg class="circuit" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Diagrama del circuito">` +
    line(padX, cy, x0, cy) + line(x0 + node.w, cy, W - padX, cy) +
    draw(node, x0, padY) +
    `<circle class="term" cx="${padX}" cy="${cy}" r="4.5"/><circle class="term" cx="${W - padX}" cy="${cy}" r="4.5"/></svg>`;
}

/* =========================================================
   Interfaz
   ========================================================= */
const $ = s => document.querySelector(s);
let state = { target: 0, tol: 10, list: [], selected: null };

function renderHero(c) {
  state.selected = c;
  const tree = buildTree(c);
  const cls = errClass(c.err);
  const lo = c.value * (1 - state.tol / 100), hi = c.value * (1 + state.tol / 100);
  $('#hero').innerHTML = `
    <div>
      <div class="label">Valor equivalente más cercano</div>
      <div class="big">${fmtOhm(c.value, 5)}</div>
      <div class="expr">${expr(tree)}</div>
      <div class="badges">
        <span class="badge ${cls}">${Math.abs(c.err) < 5e-7 ? '✓ Valor exacto' : 'Error ' + fmtErr(c.err)}</span>
        <span class="badge info">${KINDS[c.kind].name}</span>
        <span class="badge info">Tolerancia ${state.tol} % (${state.tol === 10 ? 'E12' : 'E96'})</span>
      </div>
      <dl class="stats">
        <div><dt>Objetivo</dt><dd>${fmtOhm(state.target, 5)}</dd></div>
        <div><dt>Resistencias</dt><dd>${KINDS[c.kind].n}</dd></div>
        <div><dt>Rango real ±${state.tol} %</dt><dd>${fmtOhm(lo, 4)} – ${fmtOhm(hi, 4)}</dd></div>
      </dl>
    </div>
    <div class="diagram">${circuitSVG(tree)}</div>`;
  highlight();
}

function highlight() {
  document.querySelectorAll('#tbody tr').forEach(tr => tr.classList.toggle('active', state.list[+tr.dataset.i] === state.selected));
  document.querySelectorAll('.kind').forEach(b => b.classList.toggle('active', b.dataset.ref && state.byKind[b.dataset.ref] === state.selected));
}

function renderKinds() {
  state.byKind = {};
  for (const c of state.list) if (!state.byKind[c.kind]) state.byKind[c.kind] = c;
  $('#kinds').innerHTML = Object.keys(KINDS).map(k => {
    const c = state.byKind[k];
    if (!c) {
      return `<div class="kind empty"><div class="k-name">${KINDS[k].name}</div><div class="k-val">—</div><div class="k-err">No incluida</div></div>`;
    }
    return `<button type="button" class="kind" data-ref="${k}">
      <div class="k-name">${KINDS[k].name}</div>
      <div class="k-val">${fmtOhm(c.value, 5)}</div>
      <div class="k-err">${expr(buildTree(c))} · ${fmtErr(c.err)}</div>
      ${circuitSVG(buildTree(c))}
    </button>`;
  }).join('');
  document.querySelectorAll('.kind[data-ref]').forEach(b =>
    b.addEventListener('click', () => renderHero(state.byKind[b.dataset.ref])));
}

function renderTable() {
  $('#tbody').innerHTML = state.list.map((c, i) => `
    <tr data-i="${i}">
      <td>${i + 1}</td>
      <td>${KINDS[c.kind].name}</td>
      <td class="mono">${expr(buildTree(c))}</td>
      <td>${fmtOhm(c.value, 5)}</td>
      <td class="err ${errClass(c.err)}">${fmtErr(c.err)}</td>
    </tr>`).join('');
  document.querySelectorAll('#tbody tr').forEach(tr =>
    tr.addEventListener('click', () => {
      renderHero(state.list[+tr.dataset.i]);
      $('#hero').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
}

function showMsg(text) {
  const m = $('#msg');
  m.textContent = text || '';
  m.hidden = !text;
}

function calculate() {
  showMsg('');
  const num = parseFloat($('#valor').value.trim().replace(',', '.'));
  const target = num * +$('#unidad').value;
  const tol = +document.querySelector('input[name="tol"]:checked').value;
  const maxN = +document.querySelector('input[name="maxn"]:checked').value;

  if (!isFinite(num) || num <= 0) return showMsg('Ingresa un valor numérico mayor que cero.');
  if (target < MIN_TARGET || target > MAX_TARGET) {
    return showMsg('El valor debe estar entre 0.1 Ω y 20 MΩ.');
  }

  const btn = $('#btn');
  btn.disabled = true; btn.textContent = 'Calculando…';
  setTimeout(() => {
    const all = search(target, tol, maxN);
    state = { target, tol, list: all.slice(0, 25), all, selected: null, byKind: {} };
    renderKinds();
    // la tabla usa las 25 mejores; las tarjetas usan el mejor de cada configuración
    state.byKind = {};
    for (const c of all) if (!state.byKind[c.kind]) state.byKind[c.kind] = c;
    renderTable();
    $('#results').hidden = false;
    renderHero(all[0]);
    btn.disabled = false; btn.textContent = 'Calcular';
  }, 20);
}

$('#form').addEventListener('submit', e => { e.preventDefault(); calculate(); });
document.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {
  $('#valor').value = ch.dataset.v;
  $('#unidad').value = ch.dataset.u;
  calculate();
}));

calculate();
