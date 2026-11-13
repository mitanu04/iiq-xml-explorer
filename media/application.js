/* Application view: Overview (references + mentions) and Schema (tables).
   All data is inserted with textContent / DOM nodes, never as HTML. */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const state = {
    model: null, file: '', tab: 'overview', scan: null, scanning: false,
    schemaIndex: 0, filter: '', sortKey: null, sortDir: 1, mentionKind: 'all'
  };
  const saved = vscode.getState();
  if (saved) { state.tab = saved.tab || state.tab; state.mentionKind = saved.mentionKind || 'all'; }

  const COLUMNS = [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'identity', label: 'Identity', flag: true, tip: 'Identity attribute of the schema' },
    { key: 'display', label: 'Display', flag: true, tip: 'Display attribute of the schema' },
    { key: 'entitlement', label: 'Entitlement', flag: true },
    { key: 'managed', label: 'Managed', flag: true },
    { key: 'multi', label: 'Multi-valued', flag: true },
    { key: 'minable', label: 'Minable', flag: true },
    { key: 'correlationKey', label: 'Correlation key', flag: true },
    { key: 'required', label: 'Required', flag: true },
    { key: 'description', label: 'Description' }
  ];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }
  function link(text, onClick, title) {
    const b = el('button', 'link', text);
    if (title) { b.title = title; }
    b.addEventListener('click', onClick);
    return b;
  }
  const reveal = offset => vscode.postMessage({ type: 'reveal', offset });
  const openAt = h => vscode.postMessage({ type: 'open', uri: h.uri, line: h.line, column: h.column });
  const key = (type, name) => type + '\u0000' + name;

  function save() { vscode.setState({ tab: state.tab, mentionKind: state.mentionKind }); }

  // ---------------------------------------------------------------- tabs
  function setTab(tab) {
    state.tab = tab;
    save();
    vscode.postMessage({ type: 'tab', tab });
    render();
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.getElementById('rescan').addEventListener('click', () => vscode.postMessage({ type: 'rescan' }));

  // ---------------------------------------------------------------- overview
  function card(label, value) {
    const c = el('div', 'card');
    c.append(el('div', 'card-value', String(value)), el('div', 'card-label', label));
    return c;
  }

  function usesCell(uses) {
    const td = el('td', 'uses');
    uses.forEach((u, i) => {
      if (i) { td.append(document.createTextNode(' ')); }
      td.append(link(u.role, () => reveal(u.offset), 'Show in the XML'));
    });
    return td;
  }

  function referenceSection(title, refs, opts) {
    const section = el('section');
    section.append(el('h2', null, `${title} (${refs.length})`));
    if (refs.length === 0) { section.append(el('p', 'muted', opts.empty)); return section; }
    const table = el('table');
    const head = el('tr');
    opts.columns.forEach(c => head.append(el('th', null, c)));
    const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    refs.forEach(r => {
      const hits = state.scan ? (state.scan.definitions[key(r.type, r.name)] || []) : null;
      const tr = el('tr');
      const nameTd = el('td', 'name');
      if (hits && hits.length) { nameTd.append(link(r.name, () => openAt(hits[0]), `Open ${hits[0].path}`)); }
      else { nameTd.append(el('span', null, r.name)); }
      tr.append(nameTd);
      if (opts.showType) { tr.append(el('td', null, r.type)); }
      if (opts.showRuleType) {
        const rt = hits && hits.find(h => h.ruleType);
        tr.append(el('td', null, rt ? rt.ruleType : ''));
      }
      tr.append(usesCell(r.uses));
      const status = el('td', 'status');
      if (hits === null) { status.append(el('span', 'muted', state.scanning ? '…' : '')); }
      else if (hits.length) {
        hits.forEach((h, i) => {
          if (i) { status.append(document.createTextNode(' ')); }
          status.append(link(`${h.path}:${h.line + 1}`, () => openAt(h)));
        });
        if (hits.length > 1) { status.append(el('span', 'badge warn', 'duplicate')); }
      } else {
        status.append(el('span', opts.warnMissing ? 'badge warn' : 'badge muted', 'not in workspace'));
      }
      tr.append(status);
      body.append(tr);
    });
    table.append(body);
    const wrap = el('div', 'table-wrap');
    wrap.append(table);
    section.append(wrap);
    return section;
  }

  function dependenciesSection() {
    const section = el('section');
    const deps = state.scan ? (state.scan.dependencies || []) : [];
    section.append(el('h2', null, state.scan ? `Indirect dependencies (${deps.length})` : 'Indirect dependencies'));
    if (!state.scan) { section.append(el('p', 'muted', state.scanning ? 'Searching the workspace…' : 'Press Refresh to search the workspace.')); return section; }
    if (deps.length === 0) {
      section.append(el('p', 'muted', 'The objects found in the workspace reference nothing further (rule libraries, correlation rules, …).'));
      return section;
    }
    section.append(el('p', 'muted small', 'Objects that the application needs through the objects above.'));
    const table = el('table');
    const head = el('tr');
    ['Object', 'Type', 'Needed by', 'Defined in'].forEach(c => head.append(el('th', null, c)));
    const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    deps.forEach(d => {
      const hits = state.scan.definitions[key(d.type, d.name)] || [];
      const tr = el('tr');
      const nameTd = el('td', 'name');
      if (hits.length) { nameTd.append(link(d.name, () => openAt(hits[0]), `Open ${hits[0].path}`)); } else { nameTd.append(el('span', null, d.name)); }
      tr.append(nameTd, el('td', null, d.type), el('td', null, d.neededBy.join(', ') + (d.depth > 2 ? `  (level ${d.depth})` : '')));
      const status = el('td', 'status');
      if (hits.length) {
        hits.forEach((h, i) => { if (i) { status.append(document.createTextNode(' ')); } status.append(link(`${h.path}:${h.line + 1}`, () => openAt(h))); });
        if (hits.length > 1) { status.append(el('span', 'badge warn', 'duplicate')); }
      } else { status.append(el('span', 'badge warn', 'not in workspace')); }
      tr.append(status);
      body.append(tr);
    });
    table.append(body);
    const wrap = el('div', 'table-wrap'); wrap.append(table); section.append(wrap);
    return section;
  }

  function filesSection() {
    const section = el('section');
    const files = state.scan ? (state.scan.files || []) : [];
    section.append(el('h2', null, state.scan ? `Files of this application (${files.length})` : 'Files of this application'));
    if (!state.scan) { section.append(el('p', 'muted', state.scanning ? 'Searching the workspace…' : 'Press Refresh to search the workspace.')); return section; }
    section.append(el('p', 'muted small', 'The application file, the files that define what it references (also indirectly), and the files that mention it. Useful to see what to take along when tracking the application in a branch.'));
    const tools = el('div', 'chips');
    [['paths', 'Copy paths'], ['markdown', 'Copy as checklist']].forEach(([format, text]) => {
      const b = el('button', 'chip', text);
      b.addEventListener('click', () => vscode.postMessage({ type: 'copyFiles', format }));
      tools.append(b);
    });
    section.append(tools);
    const table = el('table');
    const head = el('tr');
    ['File', 'Why'].forEach(c => head.append(el('th', null, c)));
    const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    files.forEach(f => {
      const tr = el('tr');
      const td = el('td', 'name');
      td.append(link(f.path, () => vscode.postMessage({ type: 'open', uri: f.uri, line: 0, column: 0 }), 'Open the file'));
      tr.append(td, el('td', null, f.reasons.join('; ')));
      body.append(tr);
    });
    table.append(body);
    const wrap = el('div', 'table-wrap'); wrap.append(table); section.append(wrap);
    return section;
  }

  function highlight(text, needle) {
    const frag = document.createDocumentFragment();
    const i = text.indexOf(needle);
    if (i < 0 || !needle) { frag.append(document.createTextNode(text)); return frag; }
    frag.append(document.createTextNode(text.slice(0, i)));
    frag.append(el('mark', null, needle));
    frag.append(document.createTextNode(text.slice(i + needle.length)));
    return frag;
  }

  function mentionsSection() {
    const section = el('section');
    const all = state.scan ? state.scan.mentions : [];
    const shown = all.filter(m => state.mentionKind === 'all' || m.kind === state.mentionKind);
    const files = new Map();
    shown.forEach(m => { if (!files.has(m.uri)) { files.set(m.uri, []); } files.get(m.uri).push(m); });

    const h = el('h2', null, state.scan ? `Mentioned in (${shown.length} in ${files.size} file${files.size === 1 ? '' : 's'})` : 'Mentioned in');
    section.append(h);
    const filters = el('div', 'chips');
    [['all', 'All'], ['xml', 'XML'], ['doc', 'Documentation']].forEach(([k, label]) => {
      const b = el('button', 'chip' + (state.mentionKind === k ? ' on' : ''), label);
      b.addEventListener('click', () => { state.mentionKind = k; save(); render(); });
      filters.append(b);
    });
    section.append(filters);

    if (!state.scan) { section.append(el('p', 'muted', state.scanning ? 'Searching the workspace…' : 'The name changed. Press Refresh to search the workspace.')); return section; }
    if (shown.length === 0) {
      section.append(el('p', 'muted', `No other ${state.mentionKind === 'xml' ? 'XML files' : state.mentionKind === 'doc' ? 'documentation files' : 'files'} mention "${state.model.name}".`));
    }
    files.forEach(list => {
      const group = el('details', 'file');
      group.open = files.size <= 12;
      const sum = el('summary');
      sum.append(el('span', 'badge ' + (list[0].kind === 'xml' ? 'xml' : 'doc'), list[0].kind === 'xml' ? 'XML' : 'DOC'),
        document.createTextNode(' ' + list[0].path), el('span', 'muted', `  ${list.length}×`));
      group.append(sum);
      list.sort((a, b) => a.line - b.line).forEach(m => {
        const row = el('div', 'mention');
        row.append(link(`line ${m.line + 1}`, () => openAt(m)));
        if (m.container) { row.append(el('span', 'container', m.container)); }
        const code = el('code', 'preview');
        code.append(highlight(m.preview, state.model.name));
        row.append(code);
        group.append(row);
      });
      section.append(group);
    });
    const note = [];
    if (state.scan.truncated) { note.push('Results were limited (500 mentions or 10,000 files).'); }
    note.push(`${state.scan.filesScanned} files searched (.xml, .md, .markdown, .txt).`);
    section.append(el('p', 'muted small', note.join(' ')));
    return section;
  }

  function renderOverview() {
    const refs = state.model.references;
    const rules = refs.filter(r => r.category === 'rule');
    const ids = refs.filter(r => r.category === 'identity');
    const others = refs.filter(r => r.category === 'other');
    const wrap = el('div', 'overview');

    const cards = el('div', 'cards');
    cards.append(card('Rules', rules.length), card('Identities', ids.length), card('Other objects', others.length),
      card('Schemas', state.model.schemas.length), card('Mentions', state.scan ? state.scan.mentions.length : '…'),
      card('Files', state.scan ? (state.scan.files || []).length : '…'));
    wrap.append(cards);

    wrap.append(referenceSection('Rules used', rules, {
      columns: ['Rule', 'Rule type', 'Used as', 'Defined in'], showRuleType: true, warnMissing: true,
      empty: 'This application does not reference any rule.'
    }));
    wrap.append(referenceSection('Identities and workgroups', ids, {
      columns: ['Name', 'Used as', 'Found in'], empty: 'No identity or workgroup is referenced (owner, revokers...).'
    }));
    wrap.append(referenceSection('Other referenced objects', others, {
      columns: ['Name', 'Type', 'Used as', 'Defined in'], showType: true,
      empty: 'No other objects are referenced.'
    }));
    wrap.append(dependenciesSection());
    wrap.append(mentionsSection());
    wrap.append(filesSection());
    return wrap;
  }

  // ---------------------------------------------------------------- schema
  function renderSchema() {
    const schemas = state.model.schemas;
    const wrap = el('div', 'schema');
    if (schemas.length === 0) { wrap.append(el('p', 'muted', 'This application has no <Schema>.')); return wrap; }
    if (state.schemaIndex >= schemas.length) { state.schemaIndex = 0; }
    const schema = schemas[state.schemaIndex];

    const chips = el('div', 'chips');
    schemas.forEach((s, i) => {
      const b = el('button', 'chip' + (i === state.schemaIndex ? ' on' : ''), `${s.objectType} (${s.rows.length})`);
      b.addEventListener('click', () => { state.schemaIndex = i; state.filter = ''; state.sortKey = null; render(); });
      chips.append(b);
    });
    wrap.append(chips);

    const meta = el('dl', 'meta-grid');
    [['Object type', schema.objectType], ['Native object type', schema.nativeObjectType],
      ['Identity attribute', schema.identityAttribute], ['Display attribute', schema.displayAttribute],
      ['Instance attribute', schema.instanceAttribute], ['Group attribute', schema.groupAttribute]]
      .filter(p => p[1]).forEach(([k, v]) => { meta.append(el('dt', null, k), el('dd', null, v)); });
    wrap.append(meta);

    const tools = el('div', 'filterbar');
    const input = el('input');
    input.type = 'search'; input.placeholder = 'Filter attributes…'; input.value = state.filter;
    input.setAttribute('aria-label', 'Filter attributes');
    tools.append(input);
    const count = el('span', 'muted');
    tools.append(count);
    wrap.append(tools);

    const wrapTable = el('div', 'table-wrap');
    const table = el('table', 'schema-table');
    const head = el('tr');
    COLUMNS.forEach(c => {
      const th = el('th', c.flag ? 'flag' : '', c.label);
      if (c.tip) { th.title = c.tip; }
      th.tabIndex = 0;
      th.setAttribute('role', 'columnheader');
      const sortBy = () => {
        if (state.sortKey === c.key) { state.sortDir = -state.sortDir; } else { state.sortKey = c.key; state.sortDir = 1; }
        draw();
      };
      th.addEventListener('click', sortBy);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(); } });
      if (state.sortKey === c.key) { th.classList.add(state.sortDir > 0 ? 'asc' : 'desc'); }
      head.append(th);
    });
    const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    table.append(body);
    wrapTable.append(table);
    wrap.append(wrapTable);

    function draw() {
      const f = state.filter.trim().toLowerCase();
      let rows = schema.rows.filter(r => !f || [r.name, r.type, r.description].some(v => v.toLowerCase().includes(f)));
      if (state.sortKey) {
        const k = state.sortKey;
        rows = rows.slice().sort((a, b) => {
          const x = a[k], y = b[k];
          if (typeof x === 'boolean') { return (Number(y) - Number(x)) * state.sortDir; }
          return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * state.sortDir;
        });
      }
      head.querySelectorAll('th').forEach((th, i) => {
        th.classList.toggle('asc', state.sortKey === COLUMNS[i].key && state.sortDir > 0);
        th.classList.toggle('desc', state.sortKey === COLUMNS[i].key && state.sortDir < 0);
      });
      body.textContent = '';
      rows.forEach(r => {
        const tr = el('tr');
        COLUMNS.forEach(c => {
          const td = el('td', c.flag ? 'flag' : (c.key === 'description' ? 'desc' : ''));
          if (c.key === 'name') { td.append(link(r.name || '(no name)', () => reveal(r.offset), 'Show in the XML')); }
          else if (c.flag) { td.textContent = r[c.key] ? '✓' : ''; if (r[c.key]) { td.title = c.label; } }
          else { td.textContent = r[c.key]; }
          tr.append(td);
        });
        body.append(tr);
      });
      count.textContent = rows.length === schema.rows.length ? `${rows.length} attributes` : `${rows.length} of ${schema.rows.length} attributes`;
      if (rows.length === 0) {
        const tr = el('tr'); const td = el('td', 'muted', 'No attributes match.'); td.colSpan = COLUMNS.length; tr.append(td); body.append(tr);
      }
    }
    input.addEventListener('input', () => { state.filter = input.value; draw(); });
    draw();
    return wrap;
  }

  // ---------------------------------------------------------------- render
  function render() {
    document.querySelectorAll('.tabs button').forEach(b => {
      const on = b.dataset.tab === state.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    content.textContent = '';
    if (!state.model) { return; }
    const schemaTab = document.getElementById('tab-schema');
    schemaTab.textContent = `Schema (${state.model.schemas.reduce((n, s) => n + s.rows.length, 0)})`;
    content.append(state.tab === 'schema' ? renderSchema() : renderOverview());
  }

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'model') {
      const nameChanged = state.model && state.model.name !== m.model.name;
      state.model = m.model; state.file = m.file;
      if (nameChanged) { state.scan = null; state.schemaIndex = 0; state.filter = ''; }
      if (m.tab) { state.tab = m.tab; }
      document.getElementById('appName').textContent = m.model.name;
      document.getElementById('appMeta').textContent = [m.model.type, m.file].filter(Boolean).join('  ·  ');
      document.title = 'Application: ' + m.model.name;
      render();
    } else if (m.type === 'stale') {
      state.scan = null; state.scanning = false; render();
    } else if (m.type === 'scanning') {
      state.scanning = true; render();
    } else if (m.type === 'scan') {
      state.scanning = false; state.scan = m.result; render();
    } else if (m.type === 'tab') {
      state.tab = m.tab; save(); render();
    } else if (m.type === 'empty') {
      state.model = null; content.textContent = ''; content.append(el('p', 'muted', m.message));
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
