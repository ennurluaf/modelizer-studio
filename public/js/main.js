import { Store, Selection } from './core/Store.js';
import { Settings } from './core/Settings.js';
import { Api } from './core/Api.js';
import { CommandRegistry } from './core/CommandRegistry.js';
import { KeybindingManager } from './core/KeybindingManager.js';
import { Clipboard } from './core/Clipboard.js';
import { DocumentFactory } from './core/DocumentFactory.js';
import { CdmAdapter } from './adapters/CdmAdapter.js';
import { LdmAdapter, PdmAdapter } from './adapters/TableAdapter.js';
import { DiagramView } from './ui/DiagramView.js';
import { Inspector } from './ui/Inspector.js';
import { IssuesPanel } from './ui/IssuesPanel.js';
import { Modal, Toast } from './ui/Modal.js';
import { LinkDialog, SettingsDialog, ImportDialog, LibraryDialog, PrintDialog } from './ui/Dialogs.js';
import { PrintService } from './ui/PrintService.js';

const DRAFT_KEY = 'modelizer.draft';
const MODEL_CODES = { cdm: 'CDM', ldm: 'LDM', pdm: 'PDM' };

/** Transformation commands: [api direction, source model, overwritten models, model to show]. */
const TRANSFORMS = {
  cdmToLdm: ['cdm-to-ldm', 'cdm', ['ldm'], 'ldm'],
  ldmToPdm: ['ldm-to-pdm', 'ldm', ['pdm'], 'pdm'],
  cdmToPdm: ['cdm-to-pdm', 'cdm', ['ldm', 'pdm'], 'pdm'],
  pdmToLdm: ['pdm-to-ldm', 'pdm', ['ldm'], 'ldm'],
  ldmToCdm: ['ldm-to-cdm', 'ldm', ['cdm'], 'cdm'],
  pdmToCdm: ['pdm-to-cdm', 'pdm', ['ldm', 'cdm'], 'cdm']
};

const debounce = (fn, ms) => {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

class App {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.settings = new Settings();
    this.store = new Store();
    this.api = new Api();
    this.commands = new CommandRegistry();
    this.keybindings = new KeybindingManager(this.settings, this.commands);
    this.clipboard = new Clipboard();
    this.validator = new window.Modelizer.ModelValidator();
    this.adapters = { cdm: new CdmAdapter(this.store), ldm: new LdmAdapter(this.store), pdm: new PdmAdapter(this.store) };
    this.issues = [];

    this.view = new DiagramView({
      canvas: this.$('canvas'), world: this.$('world'), marquee: this.$('marquee'), hint: this.$('tool-hint'),
      store: this.store, settings: this.settings, getAdapter: () => this.adapter
    });
    this.inspector = new Inspector(this.$('inspector'), {
      store: this.store, getAdapter: () => this.adapter, keybindings: this.keybindings,
      previewName: (target, raw) => this.view.previewName(target, raw), onError: (m) => Toast.error(m)
    });
    this.issuesPanel = new IssuesPanel({
      section: this.$('issues'), list: this.$('issues-list'), scope: this.$('issues-scope'), onPick: (issue) => this.showIssue(issue)
    });
    this.printer = new PrintService(this.adapters, this.settings);
    this.saveDraft = debounce(() => this.persistDraft(), 400);
    this.liveSync = debounce(() => this.syncFromCdm(), 700);
  }

  get adapter() { return this.adapters[this.store.activeModel]; }
  get selection() { return this.store.selection; }

  // ======================================================================
  // start-up
  // ======================================================================

  start() {
    this.restoreDraft();
    this.applyAppearance();
    this.registerCommands();
    this.wireDom();
    this.wireEvents();
    this.updateTabs();
    this.refresh();
  }

  restoreDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (draft && draft.doc && draft.doc.format === 'modelizer-document') {
        this.store.doc = draft.doc;
        this.store.serverId = draft.serverId || null;
        this.store.activeModel = MODEL_CODES[draft.activeModel] ? draft.activeModel : 'cdm';
        this.store.dirty = !!draft.dirty;
      }
    } catch {
      /* ignore a broken draft */
    }
  }

  persistDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        doc: this.store.doc, serverId: this.store.serverId, activeModel: this.store.activeModel, dirty: this.store.dirty
      }));
    } catch {
      /* storage full or disabled */
    }
  }

  applyAppearance() {
    document.documentElement.dataset.theme = this.settings.get('theme');
    const zoom = this.settings.get('uiZoom');
    document.documentElement.style.fontSize = `${16 * zoom}px`;
    this.$('ui-zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  }

  // ======================================================================
  // events
  // ======================================================================

  wireEvents() {
    this.store.on('change', (info = {}) => {
      this.selection.prune((item) => this.adapter.exists(item));
      if (info.replaced) this.view.resetViews();
      this.refresh();
      this.saveDraft();
      if (this.settings.get('liveSync') && this.store.activeModel === 'cdm' && !['sync', 'restore', 'Open', 'Import'].includes(info.label)
        && !String(info.label).startsWith('Transform')) this.liveSync();
    });
    this.store.on('model', () => {
      this.updateTabs();
      this.view.setTool('select');
      this.refresh();
      this.saveDraft();
    });
    this.selection.on('change', () => {
      this.view.refreshSelection();
      this.inspector.render();
      this.updateStatus();
    });
    this.settings.on('change', ({ key }) => {
      if (['theme', 'uiZoom', '*'].includes(key)) this.applyAppearance();
      if (['showRowTypes', 'gridSize', '*'].includes(key)) this.view.render();
      if (key === 'keybindings' || key === '*') this.updateTooltips();
    });
    this.view.on('zoom', (z) => {
      this.$('zoom-value').textContent = `${Math.round(z * 100)}%`;
      this.$('zoom-range').value = Math.round(z * 100);
    });
    this.view.on('error', (m) => Toast.error(m));
    this.view.on('link', ({ from, to }) => this.openLinkDialog(from, to));
    this.view.on('addNodeAt', (pos) => this.addNode(pos));
    this.view.on('focusInspector', () => this.inspector.focus(this.store.activeModel === 'cdm' ? 'name' : 'verb'));
    this.view.on('tool', (tool) => {
      document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === tool));
    });
    window.addEventListener('beforeunload', () => this.persistDraft());
  }

  wireDom() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-command]');
      if (btn && !btn.disabled) {
        this.closeMenus();
        this.commands.run(btn.dataset.command, { source: 'click', event: e });
        return;
      }
      if (!e.target.closest('.menu')) this.closeMenus();
    });

    document.querySelectorAll('.menu__trigger').forEach((trigger) => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = trigger.parentElement;
        const open = !menu.classList.contains('is-open');
        this.closeMenus();
        menu.classList.toggle('is-open', open);
        trigger.setAttribute('aria-expanded', open);
        if (open) menu.querySelector('.menu__panel button')?.focus();
      });
      trigger.addEventListener('pointerenter', () => {
        if (document.querySelector('.menu.is-open') && !trigger.parentElement.classList.contains('is-open')) trigger.click();
      });
    });
    document.querySelectorAll('.menu__panel').forEach((panel) => panel.addEventListener('keydown', (e) => {
      const items = [...panel.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[(i - 1 + items.length) % items.length].focus(); }
      if (e.key === 'Escape') { this.closeMenus(); panel.parentElement.querySelector('.menu__trigger').focus(); }
    }));

    const name = this.$('doc-name');
    name.addEventListener('change', () => {
      const value = name.value.trim() || 'Untitled model';
      this.store.mutate('Rename model', (doc) => { doc.meta.name = value; });
    });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

    this.$('zoom-range').addEventListener('input', (e) => this.view.zoomTo(Number(e.target.value) / 100));
    this.updateTooltips();
  }

  closeMenus() {
    document.querySelectorAll('.menu.is-open').forEach((m) => {
      m.classList.remove('is-open');
      m.querySelector('.menu__trigger').setAttribute('aria-expanded', 'false');
    });
  }

  /** Shows each command's current shortcut in its tooltip and in the menus. */
  updateTooltips() {
    document.querySelectorAll('[data-command]').forEach((el) => {
      const id = el.dataset.command;
      const combo = this.keybindings.bindingOf(id);
      const keys = combo ? KeybindingManager.display(combo) : '';
      if (el.closest('.menu__panel')) {
        let kbd = el.querySelector('kbd');
        if (!kbd) { kbd = document.createElement('kbd'); el.append(kbd); }
        kbd.textContent = keys;
        kbd.hidden = !keys;
        return;
      }
      const label = el.getAttribute('aria-label') || el.textContent.trim();
      if (label) el.title = keys ? `${label} (${keys})` : label;
    });
  }

  // ======================================================================
  // rendering
  // ======================================================================

  refresh({ fit = false } = {}) {
    this.issues = this.validator.validate(this.store.doc);
    this.view.setIssues(this.issues.filter((i) => i.model === this.store.activeModel));
    this.view.render();
    if (fit) this.view.fit();
    this.inspector.render();
    this.issuesPanel.update(this.issues, this.store.activeModel);
    this.updateEmptyState();
    this.updateStatus();
    const name = this.$('doc-name');
    if (document.activeElement !== name) name.value = this.store.doc.meta.name;
    document.title = `${this.store.doc.meta.name} · Modelizer Studio`;
  }

  updateTabs() {
    const model = this.store.activeModel;
    document.documentElement.dataset.model = model;
    document.querySelectorAll('.pipeline__tab').forEach((tab) => {
      const active = tab.dataset.model === model;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active);
    });
  }

  updateEmptyState() {
    const empty = !this.adapter.nodes().length;
    this.$('empty').hidden = !empty;
    if (!empty) return;
    const doc = this.store.doc;
    const texts = {
      cdm: doc.pdm.tables.length ? 'Double-click the canvas to add a class, or rebuild the CDM from your PDM with the ◂ arrows above.'
        : 'Double-click the canvas to add a class, or start from the sample.',
      ldm: doc.cdm.classes.length ? 'Generate it from the CDM with the ▸ arrow next to CDM, or double-click to add a table.'
        : 'Double-click the canvas to add a table.',
      pdm: doc.ldm.tables.length ? 'Generate it from the LDM with the ▸ arrow next to LDM, or double-click to add a table.'
        : 'Double-click the canvas to add a table.'
    };
    this.$('empty-text').textContent = texts[this.store.activeModel];
  }

  updateStatus() {
    const items = this.selection.items();
    const a = this.adapter;
    let text = 'Nothing selected';
    if (items.length === 1) {
      const it = items[0];
      if (it.type === 'node') text = `${a.nodes().find((n) => n.id === it.id)?.title || ''} selected`;
      else if (it.type === 'row') text = `${a.row(it.nodeId, it.rowId)?.name || ''} selected`;
      else text = `${a.edges().find((e) => e.id === it.id)?.label || 'Link'} selected`;
    } else if (items.length > 1) text = `${items.length} items selected`;
    this.$('status-selection').textContent = text;

    const errors = this.issues.filter((i) => i.level === 'error').length;
    const warnings = this.issues.length - errors;
    const btn = this.$('status-issues');
    btn.className = `status-issues${errors ? ' has-errors' : warnings ? ' has-warnings' : ' is-clean'}`;
    btn.innerHTML = this.issues.length
      ? `<i class="fa-solid ${errors ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}"></i> ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`
      : '<i class="fa-solid fa-circle-check"></i> Naming convention OK';

    const saved = this.$('status-saved');
    if (this.store.serverId) saved.innerHTML = this.store.dirty ? '<i class="fa-solid fa-circle-dot"></i> Unsaved changes' : '<i class="fa-solid fa-cloud"></i> Saved on server';
    else saved.innerHTML = '<i class="fa-solid fa-laptop"></i> Draft kept in this browser';

    const undo = document.querySelector('[data-command="undo"]');
    const redo = document.querySelector('[data-command="redo"]');
    if (undo) undo.disabled = !this.store.history.canUndo;
    if (redo) redo.disabled = !this.store.history.canRedo;
  }

  showIssue(issue) {
    if (!issue) return;
    this.store.setActiveModel(issue.model);
    const keys = [];
    if (issue.rowId) keys.push(Selection.row(issue.nodeId, issue.rowId));
    else if (issue.nodeId) keys.push(Selection.node(issue.nodeId));
    else if (issue.edgeId) keys.push(Selection.edge(issue.edgeId));
    this.selection.set(keys.filter((k) => this.adapter.exists(Selection.parse(k))));
    this.view.centerOn(issue);
  }

  // ======================================================================
  // commands
  // ======================================================================

  registerCommands() {
    const c = this.commands;
    c.register('undo', () => this.undoRedo('undo'))
      .register('redo', () => this.undoRedo('redo'))
      .register('copy', () => this.copy())
      .register('cut', () => this.cut())
      .register('paste', () => this.paste())
      .register('duplicate', () => this.duplicate())
      .register('delete', () => this.deleteSelection())
      .register('selectAll', () => this.selection.set(this.adapter.nodes().map((n) => Selection.node(n.id))))
      .register('rename', () => this.rename())
      .register('escape', () => { this.closeMenus(); if (!this.view.escape()) this.selection.clear(); })
      .register('addNode', () => this.addNode())
      .register('addRow', () => this.addRow())
      .register('linkTool', () => this.view.setTool(this.view.tool === 'link' ? 'select' : 'link'))
      .register('toolSelect', () => this.view.setTool('select'))
      .register('nudgeLeft', () => this.view.nudge(-1, 0))
      .register('nudgeRight', () => this.view.nudge(1, 0))
      .register('nudgeUp', () => this.view.nudge(0, -1))
      .register('nudgeDown', () => this.view.nudge(0, 1))
      .register('tabCdm', () => this.store.setActiveModel('cdm'))
      .register('tabLdm', () => this.store.setActiveModel('ldm'))
      .register('tabPdm', () => this.store.setActiveModel('pdm'))
      .register('save', () => this.save())
      .register('exportJson', () => this.exportJson())
      .register('exportSql', () => this.exportSql())
      .register('import', () => this.importDocument())
      .register('print', () => this.print())
      .register('settings', () => new SettingsDialog(this.settings, this.keybindings).open())
      .register('zoomIn', () => this.view.zoomBy(1.2))
      .register('zoomOut', () => this.view.zoomBy(1 / 1.2))
      .register('zoomReset', () => this.view.zoomTo(1))
      .register('fit', () => this.view.fit())
      .register('uiZoomIn', () => this.setUiZoom(this.settings.get('uiZoom') + 0.05))
      .register('uiZoomOut', () => this.setUiZoom(this.settings.get('uiZoom') - 0.05))
      .register('uiZoomReset', () => this.setUiZoom(1))
      .register('toggleIssues', () => this.issuesPanel.toggle())
      .register('newDocument', () => this.newDocument())
      .register('openLibrary', () => this.openLibrary())
      .register('loadSample', () => this.loadSample());
    Object.entries(TRANSFORMS).forEach(([id, spec]) => c.register(id, () => this.transform(...spec)));
  }

  setUiZoom(value) {
    this.settings.set('uiZoom', Math.round(Math.min(1.5, Math.max(0.75, value)) * 100) / 100);
  }

  undoRedo(which) {
    const label = this.store.history[which]();
    if (label) Toast.info(`${which === 'undo' ? 'Undid' : 'Redid'}: ${label}`, { timeout: 1600 });
  }

  /** Node that new or pasted fields go into: a selected table, or the table of a selected field. */
  targetNode() {
    const nodes = this.selection.nodes();
    if (nodes.length === 1) return { nodeId: nodes[0], beforeRowId: null };
    const rows = this.selection.rows();
    if (rows.length && rows.every((r) => r.nodeId === rows[0].nodeId)) {
      const list = this.adapter.rowsOf(rows[0].nodeId) || [];
      const last = Math.max(...rows.map((r) => list.findIndex((x) => x.id === r.rowId)));
      return { nodeId: rows[0].nodeId, beforeRowId: list[last + 1] ? list[last + 1].id : null };
    }
    return null;
  }

  copy({ quiet = false } = {}) {
    const nodes = this.selection.nodes();
    const rows = this.selection.rows().filter((r) => !nodes.includes(r.nodeId));
    const a = this.adapter;
    if (nodes.length) {
      this.clipboard.put(a.key, 'nodes', a.exportNodes(nodes));
      if (!quiet) Toast.info(`Copied ${nodes.length} ${nodes.length > 1 ? 'tables' : a.nodeNoun}.`, { timeout: 1600 });
      return true;
    }
    if (rows.length) {
      this.clipboard.put(a.key, 'rows', a.exportRows(rows));
      if (!quiet) Toast.info(`Copied ${rows.length} ${a.rowNoun}${rows.length > 1 ? 's' : ''}. Paste them into any table, in any model.`, { timeout: 2200 });
      return true;
    }
    if (!quiet) Toast.warning('Select tables or fields to copy.');
    return false;
  }

  cut() {
    if (this.copy({ quiet: true })) this.removeSelection('Cut');
  }

  paste() {
    const entry = this.clipboard.take();
    if (!entry) { Toast.warning('The clipboard is empty. Copy tables or fields first.'); return; }
    const a = this.adapter;
    if (entry.kind === 'rows') {
      const target = this.targetNode();
      if (!target) { Toast.warning(`Select the ${a.nodeNoun} to paste the ${a.rowNoun}s into.`); return; }
      let ids = [];
      const result = this.store.mutate('Paste fields', () => {
        const r = a.importRows(target.nodeId, entry.data, target.beforeRowId);
        ids = r.ids || [];
        return r;
      });
      if (!result.ok) { Toast.error(result.error); return; }
      this.selection.set(ids.map((id) => Selection.row(target.nodeId, id)));
      if (entry.model !== a.key) Toast.info(`Fields converted from the ${MODEL_CODES[entry.model]} to the ${MODEL_CODES[a.key]} convention.`, { timeout: 2400 });
      return;
    }
    if (entry.model !== a.key) {
      Toast.warning(`Tables can only be pasted into the ${MODEL_CODES[entry.model]}. Fields can be pasted into any model.`);
      return;
    }
    const offset = 40 * entry.pasteCount;
    let ids = [];
    this.store.mutate('Paste', () => {
      const r = a.importNodes(entry.data, { x: offset, y: offset });
      ids = r.ids || [];
      return r;
    });
    this.selection.set(ids.map((id) => Selection.node(id)));
  }

  duplicate() {
    const a = this.adapter;
    const nodes = this.selection.nodes();
    if (nodes.length) {
      let ids = [];
      this.store.mutate('Duplicate', () => {
        const r = a.importNodes(a.exportNodes(nodes), { x: 40, y: 40 });
        ids = r.ids || [];
        return r;
      });
      this.selection.set(ids.map((id) => Selection.node(id)));
      return;
    }
    const rows = this.selection.rows();
    const target = this.targetNode();
    if (!rows.length || !target) { Toast.warning('Select tables, or fields of one table, to duplicate.'); return; }
    let ids = [];
    this.store.mutate('Duplicate fields', () => {
      const r = a.importRows(target.nodeId, a.exportRows(rows), target.beforeRowId);
      ids = r.ids || [];
      return r;
    });
    this.selection.set(ids.map((id) => Selection.row(target.nodeId, id)));
  }

  describeSelection() {
    const a = this.adapter;
    const n = this.selection.nodes().length;
    const r = this.selection.rows().length;
    const e = this.selection.edges().length;
    const parts = [];
    if (n) parts.push(n === 1 ? `the ${a.nodeNoun} "${a.nodes().find((x) => x.id === this.selection.nodes()[0])?.title}"` : `${n} ${a.key === 'cdm' ? 'classes' : 'tables'}`);
    if (r) parts.push(`${r} ${a.rowNoun}${r > 1 ? 's' : ''}`);
    if (e) parts.push(`${e} link${e > 1 ? 's' : ''}`);
    return parts.join(', ');
  }

  async confirmDelete(what) {
    if (!this.settings.get('confirmDelete')) return true;
    const answer = await Modal.confirm({
      title: 'Delete?', icon: 'fa-trash-can', danger: true, confirmLabel: 'Delete', dontAsk: true,
      message: `Delete ${what}? You can undo this with ${KeybindingManager.display(this.keybindings.bindingOf('undo')) || 'Undo'}.`
    });
    if (answer.ok && answer.dontAsk) {
      this.settings.set('confirmDelete', false);
      Toast.info('Delete confirmations are off. Turn them back on in Settings.');
    }
    return answer.ok;
  }

  async deleteSelection() {
    if (!this.selection.size) return;
    if (!(await this.confirmDelete(this.describeSelection()))) return;
    this.removeSelection('Delete');
  }

  removeSelection(label) {
    const a = this.adapter;
    const sel = this.selection;
    this.store.mutate(label, () => a.removeSelection(sel));
    this.selection.clear();
  }

  rename() {
    const items = this.selection.items();
    if (items.length !== 1) return;
    const it = items[0];
    if (it.type === 'node') this.view.editNode(it.id);
    else if (it.type === 'row') this.view.editRow(it.nodeId, it.rowId);
    else this.inspector.focus(this.store.activeModel === 'cdm' ? 'name' : 'verb');
  }

  addNode(pos) {
    const a = this.adapter;
    let id = null;
    const snap = (v) => (this.settings.get('snapToGrid') ? Math.round(v / this.settings.get('gridSize')) * this.settings.get('gridSize') : v);
    const p = pos || this.view.visibleCenter();
    this.store.mutate(`Add ${a.nodeNoun}`, () => {
      const r = a.addNode({ x: snap(p.x), y: snap(p.y) });
      id = r.id;
      return r;
    });
    if (!id) return;
    this.selection.set([Selection.node(id)]);
    this.view.editNode(id);
  }

  addRow() {
    const a = this.adapter;
    const target = this.targetNode();
    if (!target) { Toast.warning(`Select a ${a.nodeNoun} first.`); return; }
    let id = null;
    const result = this.store.mutate(`Add ${a.rowNoun}`, () => {
      const r = a.addRow(target.nodeId);
      id = r.id;
      if (r.ok && target.beforeRowId) a.reorderRows(target.nodeId, [id], target.beforeRowId);
      return r;
    });
    if (!result.ok) { Toast.error(result.error); return; }
    this.selection.set([Selection.row(target.nodeId, id)]);
    this.view.editRow(target.nodeId, id);
  }

  openLinkDialog(from, to) {
    const a = this.adapter;
    const spec = a.linkDialogSpec(from, to);
    if (!spec) return;
    const dialog = new LinkDialog(spec, a, (values) => {
      let id = null;
      const result = this.store.mutate(a.key === 'cdm' ? 'Add association' : 'Add foreign key', () => {
        const r = a.createLink(from, to, values);
        id = r.id;
        return r;
      });
      if (result.ok) this.selection.set([Selection.edge(id)]);
      return result;
    });
    dialog.open();
  }

  // ---------- transformations ----------

  async transform(direction, source, targets, show) {
    const doc = this.store.doc;
    const isEmpty = (m) => (m === 'cdm' ? !doc.cdm.classes.length : !doc[m].tables.length);
    if (isEmpty(source)) {
      Toast.warning(`The ${MODEL_CODES[source]} is empty, so there is nothing to transform yet.`);
      return;
    }
    const overwritten = targets.filter((m) => !isEmpty(m));
    if (overwritten.length && this.settings.get('confirmOverwrite')) {
      const answer = await Modal.confirm({
        title: 'Replace model?', icon: 'fa-shuffle', confirmLabel: 'Replace', dontAsk: true,
        message: `This rebuilds the ${overwritten.map((m) => MODEL_CODES[m]).join(' and ')} from the ${MODEL_CODES[source]}. Table positions and PDM data types are kept where the names match. It can be undone.`
      });
      if (!answer.ok) return;
      if (answer.dontAsk) this.settings.set('confirmOverwrite', false);
    }
    try {
      const { document } = await this.api.transform(direction, doc);
      document.meta.name = this.store.doc.meta.name;
      this.store.history.checkpoint(`Transform ${MODEL_CODES[source]} → ${targets.map((m) => MODEL_CODES[m]).join(' + ')}`);
      this.store.doc = document;
      targets.filter((m) => !overwritten.includes(m)).forEach((m) => { this.view.viewStates[m].fitted = false; });
      this.selection.clear();
      this.store.changed(`Transform ${direction}`);
      this.store.setActiveModel(show);
      const count = this.validator.validate(document).filter((i) => i.model === show).length;
      Toast.success(`${MODEL_CODES[show]} generated from the ${MODEL_CODES[source]}${count ? ` — ${count} naming issue${count > 1 ? 's' : ''} to review` : ''}.`);
    } catch (err) {
      Toast.error(err.message);
    }
  }

  async syncFromCdm() {
    if (!this.store.doc.cdm.classes.length) return;
    try {
      const { document } = await this.api.transform('cdm-to-pdm', this.store.doc);
      const doc = this.store.doc;
      doc.ldm = document.ldm;
      doc.pdm = document.pdm;
      doc.layout.pdm = document.layout.pdm;
      Object.entries(document.layout.shared).forEach(([id, p]) => { if (!doc.layout.shared[id]) doc.layout.shared[id] = p; });
      this.store.emit('change', { label: 'sync' });
    } catch (err) {
      Toast.error(`Live sync: ${err.message}`);
    }
  }

  // ---------- files ----------

  download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  slug() {
    return (this.store.doc.meta.name || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';
  }

  exportJson() {
    this.download(`${this.slug()}.modelizer.json`, JSON.stringify(this.store.doc, null, 2), 'application/json');
    Toast.success('Exported the CDM, LDM and PDM in one JSON file.');
  }

  async exportSql() {
    if (!this.store.doc.pdm.tables.length) { Toast.warning('The PDM is empty. Generate it from the LDM first.'); return; }
    try {
      const { sql } = await this.api.exportSql(this.store.doc);
      this.download(`${this.slug()}.sql`, sql, 'text/plain');
    } catch (err) { Toast.error(err.message); }
  }

  async confirmReplace(action) {
    if (DocumentFactory.isEmpty(this.store.doc) || !this.settings.get('confirmOverwrite')) return true;
    const answer = await Modal.confirm({
      title: 'Replace the current model?', icon: 'fa-file-circle-exclamation', confirmLabel: action,
      message: `"${this.store.doc.meta.name}" will be replaced. ${this.store.serverId && !this.store.dirty ? 'It is saved on the server.' : 'Export or save it first if you want to keep it.'} Undo brings it back.`
    });
    return answer.ok;
  }

  openDocument(doc, { serverId = null, label = 'Open' } = {}) {
    this.store.replaceDocument(doc, { serverId, label });
    this.store.dirty = false;
    const first = ['cdm', 'ldm', 'pdm'].find((m) => (m === 'cdm' ? doc.cdm.classes.length : doc[m].tables.length)) || 'cdm';
    this.store.setActiveModel(first);
    this.updateStatus();
  }

  async importDocument() {
    const result = await new ImportDialog(this.api).open();
    if (!result) return;
    if (!(await this.confirmReplace('Import'))) return;
    this.openDocument(result.document, { label: 'Import' });
    this.store.dirty = true;
    const errors = result.issues.filter((i) => i.level === 'error').length;
    Toast.success(`Imported "${result.document.meta.name}".${errors ? ` ${errors} naming error${errors > 1 ? 's' : ''} found — open the issues panel to fix them.` : ''}`);
  }

  async save() {
    try {
      const result = this.store.serverId
        ? await this.api.saveModel(this.store.serverId, this.store.doc)
        : await this.api.createModel(this.store.doc);
      this.store.serverId = result.id;
      this.store.dirty = false;
      this.persistDraft();
      this.updateStatus();
      Toast.success(`Saved "${this.store.doc.meta.name}" on the server.`);
    } catch (err) { Toast.error(err.message); }
  }

  async openLibrary() {
    const result = await new LibraryDialog(this.api, (what) => this.confirmDelete(what)).open();
    if (!result) return;
    if (this.store.dirty && !(await this.confirmReplace('Open'))) return;
    this.openDocument(result.document, { serverId: result.id });
  }

  async newDocument() {
    if (!(await this.confirmReplace('New model'))) return;
    this.openDocument(DocumentFactory.empty(), { label: 'New model' });
  }

  async loadSample() {
    try {
      const response = await fetch('samples/protraining360.json');
      if (!response.ok) throw new Error('The sample could not be loaded.');
      const doc = await response.json();
      if (!(await this.confirmReplace('Load sample'))) return;
      this.openDocument(doc, { label: 'Load sample' });
      Toast.success('Loaded the ProTraining360 sample with its CDM, LDM and PDM.');
    } catch (err) { Toast.error(err.message); }
  }

  async print() {
    const doc = this.store.doc;
    const counts = { cdm: doc.cdm.classes.length, ldm: doc.ldm.tables.length, pdm: doc.pdm.tables.length };
    if (!counts.cdm && !counts.ldm && !counts.pdm) { Toast.warning('There is nothing to print yet.'); return; }
    const options = await new PrintDialog(doc.meta.name, counts).open();
    if (options) this.printer.print(options);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (!window.Modelizer || !window.Modelizer.NamingConvention) {
    document.body.innerHTML = '<p style="padding:2rem;font-family:sans-serif">Start the app with <code>npm start</code> and open http://localhost:3000 — the shared naming-convention scripts are served by the Node backend.</p>';
    return;
  }
  const app = new App();
  app.start();
  window.modelizer = app;
});
