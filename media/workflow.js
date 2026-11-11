// Workflow Diagram webview: draws steps and transitions as an SVG flowchart.
// Receives { type: 'model' | 'highlight' | 'empty' } messages from the extension.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const NS = 'http://www.w3.org/2000/svg';

  const W = 184;            // step box width
  const H = 58;             // step box height
  const MIN_COL_GAP = 150;  // auto layout: minimum horizontal gap between ranks
  const MIN_ROW_GAP = 54;   // auto layout: minimum vertical gap inside a rank
  const LABEL_MAX_CH = 46;  // condition labels wrap after this many characters
  const LABEL_CH_W = 6.7;   // approx. width of one 11px monospace character
  const LABEL_LINE_H = 14;  // label line height
  let COL_GAP = MIN_COL_GAP;
  let ROW_GAP = MIN_ROW_GAP;

  const KIND_LABEL = {
    start: 'START', stop: 'STOP', approval: 'APPROVAL', rule: 'RULE', script: 'SCRIPT',
    call: 'CALL', subprocess: 'SUBPROCESS', step: 'STEP', missing: 'MISSING'
  };

  const svg = document.getElementById('svg');
  const vp = document.getElementById('viewport');
  const stage = document.getElementById('stage');
  const emptyEl = document.getElementById('empty');
  const layoutSel = document.getElementById('layout');

  let model = null;
  let positions = null;      // name -> {x, y} (centre)
  let highlighted = null;
  let view = { x: 0, y: 0, k: 1 };
  let condMode = saved.cond || 'full';   // 'full' shows the whole condition, 'short' a one-line preview
  let layoutMode = saved.layout || 'iiq';  // falls back to automatic when steps have no posX/posY
  let iiqAvailable = false;
  let lastWorkflow = null;

  // ---------------------------------------------------------------- helpers

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) { if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]); }
    if (parent) parent.appendChild(e);
    return e;
  }
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function persist() { vscode.setState({ layout: layoutMode, cond: condMode }); }

  // ---------------------------------------------------------------- condition labels

  /** Text shown on a transition: the full `when` (or a short preview), or "else" for the fallback. */
  function conditionText(t) {
    if (!t.when) return t.siblings > 1 ? 'else' : '';
    const flat = t.when.replace(/\s+/g, ' ').trim();
    return condMode === 'full' ? flat : trunc(flat.replace(/^script:/, ''), 34);
  }

  /** Word-wraps a condition; breaks very long tokens (no spaces) at operators or hard. */
  function wrap(text, max) {
    if (text.length <= max) return [text];
    const tokens = text.split(/(?<=[ ,(&|])/);
    const lines = [];
    let cur = '';
    for (let tok of tokens) {
      while (tok.length > max) {
        if (cur) { lines.push(cur.trimEnd()); cur = ''; }
        lines.push(tok.slice(0, max));
        tok = tok.slice(max);
      }
      if ((cur + tok).length > max && cur) { lines.push(cur.trimEnd()); cur = ''; }
      cur += tok;
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    return lines;
  }

  function labelLines(t) {
    const text = conditionText(t);
    const order = t.siblings > 1 ? String(t.order) : '';
    if (!text && !order) return null;
    const lines = text ? wrap(text, LABEL_MAX_CH) : [''];
    return { order, lines };
  }

  /** Estimated label size, used to space the layout before anything is drawn. */
  function labelSize(t) {
    const l = labelLines(t);
    if (!l) return null;
    const longest = Math.max(...l.lines.map((x, i) => x.length + (i === 0 && l.order ? l.order.length + 2 : 0)));
    return { w: longest * LABEL_CH_W + 12, h: l.lines.length * LABEL_LINE_H + 6 };
  }

  // ---------------------------------------------------------------- layout

  /** Uses the posX/posY saved by the IIQ Business Process Editor, scaled so boxes never overlap. */
  function iiqLayout(m) {
    const steps = m.steps;
    const real = steps.filter(s => s.kind !== 'missing');
    if (real.length === 0 || real.some(s => s.posX === undefined || s.posY === undefined)) return null;
    let minRatio = Infinity;
    for (let i = 0; i < real.length; i++) {
      for (let j = i + 1; j < real.length; j++) {
        const dx = Math.abs(real[i].posX - real[j].posX);
        const dy = Math.abs(real[i].posY - real[j].posY);
        if (dx === 0 && dy === 0) return null; // two steps on the same spot: positions are not usable
        minRatio = Math.min(minRatio, Math.max(dx / (W + 36), dy / (H + 30)));
      }
    }
    let scale = real.length === 1 ? 1 : Math.max(1, 1 / minRatio);
    // Spread steps further apart when a condition label needs the room between them.
    const byName = {};
    for (const s of real) byName[s.name] = s;
    for (const t of m.transitions) {
      const a = byName[t.from], b = byName[t.to];
      const size = labelSize(t);
      if (!a || !b || !size || a === b) continue;
      const dx = Math.abs(a.posX - b.posX), dy = Math.abs(a.posY - b.posY);
      if (dx >= dy && dx > 0) scale = Math.max(scale, (W + size.w + 30) / dx);
      else if (dy > 0) scale = Math.max(scale, (H + size.h + 30) / dy);
    }
    scale = Math.min(14, scale);
    const pos = {};
    for (const s of real) pos[s.name] = { x: s.posX * scale, y: s.posY * scale };
    // Missing targets go to the right of everything.
    const maxX = Math.max(...real.map(s => pos[s.name].x));
    let row = 0;
    for (const s of steps) if (s.kind === 'missing') pos[s.name] = { x: maxX + W + COL_GAP, y: (row++) * (H + ROW_GAP) };
    return pos;
  }

  /** Left-to-right layered layout: rank = longest path from the start step (back edges ignored). */
  function autoLayout(m) {
    const out = {};
    for (const s of m.steps) out[s.name] = [];
    for (const t of m.transitions) if (out[t.from] && out[t.to] && t.from !== t.to) out[t.from].push(t.to);

    // Find back edges with a DFS from the start step.
    const order = [];
    const state = {};
    const back = new Set();
    function dfs(n) {
      state[n] = 1;
      for (const c of out[n]) {
        if (state[c] === 1) back.add(n + '\u0000' + c);
        else if (!state[c]) dfs(c);
      }
      state[n] = 2;
      order.push(n);
    }
    if (m.startStep && out[m.startStep]) dfs(m.startStep);
    for (const s of m.steps) if (!state[s.name]) dfs(s.name);

    // Longest-path ranks over the DAG (reverse post-order = topological order).
    const rank = {};
    for (const s of m.steps) rank[s.name] = 0;
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      for (const c of out[n]) {
        if (back.has(n + '\u0000' + c)) continue;
        rank[c] = Math.max(rank[c], rank[n] + 1);
      }
    }
    // Stop steps go to the last column for a clean right edge.
    const maxRank = Math.max(0, ...Object.values(rank));
    for (const s of m.steps) if (s.kind === 'stop') rank[s.name] = Math.max(rank[s.name], maxRank);

    const columns = {};
    for (const s of m.steps) (columns[rank[s.name]] = columns[rank[s.name]] || []).push(s.name);

    // Order inside a column: by the average row of the predecessors (one sweep keeps edges straighter).
    const row = {};
    const ranks = Object.keys(columns).map(Number).sort((a, b) => a - b);
    for (const r of ranks) {
      const col = columns[r];
      col.forEach((n, i) => { row[n] = i; });
      if (r > 0) {
        const bary = n => {
          const preds = m.transitions.filter(t => t.to === n && rank[t.from] < r).map(t => row[t.from]);
          return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : row[n];
        };
        col.sort((a, b) => bary(a) - bary(b));
        col.forEach((n, i) => { row[n] = i; });
      }
    }

    const tallest = Math.max(...ranks.map(r => columns[r].length));
    const pos = {};
    for (const r of ranks) {
      const col = columns[r];
      const offset = (tallest - col.length) * (H + ROW_GAP) / 2;
      col.forEach((n, i) => { pos[n] = { x: r * (W + COL_GAP), y: offset + i * (H + ROW_GAP) }; });
    }
    return pos;
  }

  // ---------------------------------------------------------------- geometry

  /** Point where the line from the box centre towards (tx, ty) leaves the box. */
  function borderPoint(c, tx, ty, kind) {
    const dx = tx - c.x, dy = ty - c.y;
    if (dx === 0 && dy === 0) return { x: c.x, y: c.y };
    const hw = (kind === 'start' || kind === 'stop') ? W / 2 - 34 : W / 2;
    const hh = H / 2;
    const s = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
    return { x: c.x + dx * s, y: c.y + dy * s };
  }

  // ---------------------------------------------------------------- render

  function render() {
    vp.textContent = '';
    if (!model) return;

    // Gaps grow with the biggest condition label so labels fit between the steps.
    const sizes = model.transitions.map(labelSize).filter(Boolean);
    const maxW = sizes.length ? Math.max(...sizes.map(z => z.w)) : 0;
    const maxH = sizes.length ? Math.max(...sizes.map(z => z.h)) : 0;
    COL_GAP = Math.min(560, Math.max(MIN_COL_GAP, maxW + 50));
    ROW_GAP = Math.min(200, Math.max(MIN_ROW_GAP, maxH + 24));

    const iiqPos = iiqLayout(model);
    iiqAvailable = !!iiqPos;
    layoutSel.querySelector('option[value="iiq"]').disabled = !iiqAvailable;
    layoutSel.querySelector('option[value="iiq"]').textContent = iiqAvailable ? 'IIQ positions' : 'IIQ positions (not available)';
    const mode = layoutMode === 'iiq' && iiqAvailable ? 'iiq' : 'auto';
    layoutSel.value = mode;
    positions = mode === 'iiq' ? iiqPos : autoLayout(model);

    const kindOf = {};
    for (const s of model.steps) kindOf[s.name] = s.kind;

    const edgeLayer = el('g', { class: 'edges' }, vp);
    const labelLayer = el('g', { class: 'labels' }, vp);
    const nodeLayer = el('g', { class: 'nodes' }, vp);

    // Pairs with transitions both ways, or several transitions between the same steps, get curved apart.
    const pairCount = {};
    const pairIndex = {};
    for (const t of model.transitions) {
      const key = [t.from, t.to].sort().join('\u0000');
      pairCount[key] = (pairCount[key] || 0) + 1;
    }

    const labels = [];
    model.transitions.forEach((t, idx) => {
      const a = positions[t.from], b = positions[t.to];
      if (!a || !b) return;
      const g = el('g', { class: 'edge' + (t.when ? ' conditional' : ''), 'data-from': t.from, 'data-to': t.to }, edgeLayer);
      let d, mid;

      if (t.from === t.to) {
        const x = a.x + W / 2, y = a.y - H / 4;
        d = `M ${x} ${y} C ${x + 60} ${y - 50}, ${x + 60} ${y + 50 + H / 2}, ${x} ${a.y + H / 4}`;
        mid = { x: x + 46, y: a.y };
      } else {
        const key = [t.from, t.to].sort().join('\u0000');
        const n = pairCount[key];
        const i = pairIndex[key] = (pairIndex[key] || 0) + 1;
        const isBack = positions[t.to].x < positions[t.from].x - 1;
        // Bend: spread multiple edges between the same pair; back edges always bend.
        let bend = n > 1 ? (i - (n + 1) / 2) * 64 : 0;
        if (isBack && bend === 0) bend = 60;
        if (n > 1 && t.from > t.to) bend = -bend; // same side regardless of direction, so they separate
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        const cx = mx + nx * bend * 2, cy = my + ny * bend * 2;
        const p1 = borderPoint(a, bend ? cx : b.x, bend ? cy : b.y, kindOf[t.from]);
        const p2 = borderPoint(b, bend ? cx : a.x, bend ? cy : a.y, kindOf[t.to]);
        d = bend ? `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}` : `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
        mid = bend ? { x: 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x, y: 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y }
                   : { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      }

      el('path', { d, class: 'hit' }, g);
      el('path', { d, class: 'line', 'marker-end': 'url(#arrow)' }, g);
      const title = el('title', {}, g);
      title.textContent = `${t.from} → ${t.to}` + (t.siblings > 1 ? `  (transition ${t.order} of ${t.siblings})` : '') + (t.when ? `\nwhen: ${t.when}` : '');
      g.addEventListener('click', () => vscode.postMessage({ type: 'reveal', offset: t.offset }));

      // Label: evaluation order (when the step has several transitions) and the condition.
      const ll = labelLines(t);
      if (ll) {
        const lg = el('g', { class: 'label' + (t.when ? '' : ' plain'), 'data-from': t.from, 'data-to': t.to }, labelLayer);
        const bg = el('rect', { rx: 4 }, lg);
        const n = ll.lines.length;
        const tx = el('text', { x: mid.x, y: mid.y - (n - 1) * LABEL_LINE_H / 2, 'text-anchor': n > 1 ? 'start' : 'middle', 'dominant-baseline': 'central' }, lg);
        ll.lines.forEach((line, i) => {
          if (i === 0 && ll.order) {
            const num = el('tspan', { class: 'order' }, tx);
            num.textContent = ll.order + (line ? '  ' : '');
          }
          const span = el('tspan', i === 0 ? {} : { dy: LABEL_LINE_H }, tx);
          span.textContent = line;
        });
        // Multi-line labels are left-aligned inside a box centred on the edge.
        if (n > 1) {
          const longest = Math.max(...ll.lines.map((x, i) => x.length + (i === 0 && ll.order ? ll.order.length + 2 : 0)));
          const left = mid.x - longest * LABEL_CH_W / 2;
          tx.setAttribute('x', left);
          for (const sp of tx.querySelectorAll('tspan')) if (sp.getAttribute('dy')) sp.setAttribute('x', left);
        }
        const lt = el('title', {}, lg);
        lt.textContent = t.when ? `when: ${t.when}` : 'taken when no earlier transition matches';
        lg.addEventListener('click', () => vscode.postMessage({ type: 'reveal', offset: t.offset }));
        labels.push({ g: lg, bg, tx });
      }
      void idx;
    });

    // Size label backgrounds, then push overlapping labels apart (greedy, top to bottom).
    requestAnimationFrame(() => {
      const boxes = [];
      for (const l of labels) {
        let bb;
        try { bb = l.tx.getBBox(); } catch (e) { continue; }
        const b = { l, x: bb.x - 5, y: bb.y - 2, w: bb.width + 10, h: bb.height + 4, dy: 0 };
        l.bg.setAttribute('x', b.x); l.bg.setAttribute('y', b.y);
        l.bg.setAttribute('width', b.w); l.bg.setAttribute('height', b.h);
        boxes.push(b);
      }
      // Step boxes are fixed obstacles; labels try small vertical shifts (0, +d, -d, +2d...) until clear.
      const obstacles = model.steps.filter(st => positions[st.name]).map(st => {
        const p = positions[st.name];
        const bw = (st.kind === 'start' || st.kind === 'stop') ? W - 68 : W;
        return { x: p.x - bw / 2 - 4, y: p.y - H / 2 - 4, w: bw + 8, h: H + 8, dy: 0 };
      });
      const overlaps = (a, dy, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y + dy < b.y + b.dy + b.h && b.y + b.dy < a.y + dy + a.h;
      boxes.sort((a, b) => b.w * b.h - a.w * a.h); // place big labels first
      const placed = [];
      for (const a of boxes) {
        const step = Math.max(10, a.h / 2 + 4);
        let best = 0;
        for (let k = 0; k < 24; k++) {
          const dy = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step;
          if (!obstacles.some(o => overlaps(a, dy, o)) && !placed.some(o => overlaps(a, dy, o))) { best = dy; break; }
          if (k === 23) best = 0;
        }
        a.dy = best;
        placed.push(a);
        if (a.dy) a.l.g.setAttribute('transform', `translate(0 ${a.dy})`);
      }
    });

    for (const s of model.steps) {
      const p = positions[s.name];
      if (!p) continue;
      const round = s.kind === 'start' || s.kind === 'stop';
      const bw = round ? W - 68 : W;
      const g = el('g', { class: `node kind-${s.kind}` + (s.name === highlighted ? ' active' : ''), transform: `translate(${p.x - bw / 2} ${p.y - H / 2})`, 'data-name': s.name, tabindex: s.offset >= 0 ? 0 : -1 }, nodeLayer);
      el('rect', { class: 'box', width: bw, height: H, rx: round ? H / 2 : 7 }, g);
      if (!round) {
        el('rect', { class: 'stripe', width: 5, height: H - 14, x: 0, y: 7, rx: 2 }, g);
        const k = el('text', { class: 'kind', x: 14, y: 15 }, g); k.textContent = KIND_LABEL[s.kind];
        const n = el('text', { class: 'name', x: 14, y: 33 }, g); n.textContent = trunc(s.name, 24);
        if (s.detail) { const dt = el('text', { class: 'detail', x: 14, y: 49 }, g); dt.textContent = trunc(s.detail, 30); }
      } else {
        const n = el('text', { class: 'name', x: bw / 2, y: H / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
        n.textContent = trunc(s.name, 14);
      }
      const title = el('title', {}, g);
      title.textContent = `${s.name}\n${KIND_LABEL[s.kind]}${s.tooltip && s.tooltip !== s.name ? '\n' + s.tooltip : ''}`;

      const open = () => { if (s.offset >= 0) vscode.postMessage({ type: 'reveal', offset: s.offset }); };
      g.addEventListener('click', open);
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      g.addEventListener('mouseenter', () => setHot(s.name));
      g.addEventListener('mouseleave', () => setHot(null));
    }
    applyView();
  }

  function setHot(name) {
    for (const e of vp.querySelectorAll('.edge, .label')) {
      const on = name && (e.dataset.from === name || e.dataset.to === name);
      e.classList.toggle('hot', !!on);
      e.classList.toggle('dim', !!name && !on);
      const line = e.querySelector('.line');
      if (line) line.setAttribute('marker-end', on ? 'url(#arrowHot)' : 'url(#arrow)');
    }
  }

  function updateHighlight(scroll) {
    for (const n of vp.querySelectorAll('.node')) n.classList.toggle('active', n.dataset.name === highlighted);
    if (scroll && highlighted && positions && positions[highlighted]) {
      const p = positions[highlighted];
      const r = stage.getBoundingClientRect();
      const sx = p.x * view.k + view.x, sy = p.y * view.k + view.y;
      if (sx < 40 || sy < 40 || sx > r.width - 40 || sy > r.height - 40) {
        view.x = r.width / 2 - p.x * view.k;
        view.y = r.height / 2 - p.y * view.k;
        applyView();
      }
    }
  }

  // ---------------------------------------------------------------- pan & zoom

  function applyView() { vp.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`); }

  /** Fit everything; on first open never go below a readable zoom (start from the left instead). */
  function fit(readable) {
    if (!positions) return;
    const pts = Object.values(positions);
    if (!pts.length) return;
    const minX = Math.min(...pts.map(p => p.x)) - W / 2 - 40, maxX = Math.max(...pts.map(p => p.x)) + W / 2 + 80;
    const minY = Math.min(...pts.map(p => p.y)) - H / 2 - 50, maxY = Math.max(...pts.map(p => p.y)) + H / 2 + 50;
    const r = stage.getBoundingClientRect();
    const k = Math.max(0.2, Math.min(1.4, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    view = { k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k };
    if (readable === true && k < 0.65) {
      const k2 = 0.65;
      const start = model && model.startStep && positions[model.startStep];
      view = { k: k2, x: 24 - minX * k2, y: start ? r.height / 2 - start.y * k2 : 24 - minY * k2 };
    }
    applyView();
  }

  function zoomAt(factor, cx, cy) {
    const k = Math.max(0.15, Math.min(3, view.k * factor));
    view.x = cx - (cx - view.x) * (k / view.k);
    view.y = cy - (cy - view.y) * (k / view.k);
    view.k = k;
    applyView();
  }

  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  let drag = null;
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('.node, .edge, .label')) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    view.x = drag.vx + e.clientX - drag.x;
    view.y = drag.vy + e.clientY - drag.y;
    applyView();
  });
  const endDrag = () => { drag = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('keydown', e => {
    const step = 60;
    if (e.key === '+' || e.key === '=') zoomAt(1.15, stage.clientWidth / 2, stage.clientHeight / 2);
    else if (e.key === '-') zoomAt(1 / 1.15, stage.clientWidth / 2, stage.clientHeight / 2);
    else if (e.key === '0' || e.key.toLowerCase() === 'f') fit();
    else if (e.key === 'ArrowLeft') { view.x += step; applyView(); }
    else if (e.key === 'ArrowRight') { view.x -= step; applyView(); }
    else if (e.key === 'ArrowUp') { view.y += step; applyView(); }
    else if (e.key === 'ArrowDown') { view.y -= step; applyView(); }
  });

  document.getElementById('zoomIn').onclick = () => zoomAt(1.2, stage.clientWidth / 2, stage.clientHeight / 2);
  document.getElementById('zoomOut').onclick = () => zoomAt(1 / 1.2, stage.clientWidth / 2, stage.clientHeight / 2);
  document.getElementById('fit').onclick = () => fit(false);
  layoutSel.onchange = () => { layoutMode = layoutSel.value; persist(); render(); fit(); };
  const condSel = document.getElementById('conditions');
  condSel.value = condMode;
  condSel.onchange = () => { condMode = condSel.value; persist(); render(); fit(); };

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fit, 150); });

  // ---------------------------------------------------------------- header & legend

  function renderHeader(file) {
    document.getElementById('wfName').textContent = model.name;
    const meta = [];
    if (model.type) meta.push(model.type);
    meta.push(`${model.steps.filter(s => s.kind !== 'missing').length} steps`);
    meta.push(`${model.transitions.length} transitions`);
    meta.push(`${model.variables} variables`);
    if (file) meta.push(file);
    document.getElementById('wfMeta').textContent = meta.join('  ·  ');

    const legend = document.getElementById('legend');
    legend.textContent = '';
    const kinds = [...new Set(model.steps.map(s => s.kind))].filter(k => k !== 'start' && k !== 'stop');
    for (const k of kinds) {
      const item = document.createElement('span');
      item.className = 'key kind-' + k;
      item.textContent = KIND_LABEL[k].toLowerCase();
      legend.appendChild(item);
    }
    const cond = document.createElement('span');
    cond.className = 'key cond';
    cond.textContent = 'conditional transition';
    legend.appendChild(cond);
    if (model.warnings.length) {
      const w = document.createElement('span');
      w.className = 'warn';
      w.textContent = `⚠ ${model.warnings.length} warning${model.warnings.length === 1 ? '' : 's'}`;
      w.title = model.warnings.join('\n');
      legend.appendChild(w);
    }
  }

  // ---------------------------------------------------------------- messages

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'model') {
      const isNew = msg.model.name !== lastWorkflow;
      lastWorkflow = msg.model.name;
      model = msg.model;
      highlighted = msg.highlight;
      emptyEl.hidden = true;
      svg.style.display = '';
      renderHeader(msg.file);
      render();
      if (isNew) fit(true);
    } else if (msg.type === 'highlight') {
      highlighted = msg.step;
      updateHighlight(true);
    } else if (msg.type === 'empty') {
      model = null;
      vp.textContent = '';
      svg.style.display = 'none';
      emptyEl.textContent = msg.message;
      emptyEl.hidden = false;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
