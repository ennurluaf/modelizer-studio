import { EventBus } from '../core/EventBus.js';
import { Selection } from '../core/Store.js';
import { DiagramRenderer } from './DiagramRenderer.js';
import { TableAdapter } from '../adapters/TableAdapter.js';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const DRAG_THRESHOLD = 4;

/**
 * Interactive diagram: pan and zoom (one view state per model), selection with Ctrl/Shift
 * and marquee, dragging tables, dragging fields between tables (Alt copies), the link tool
 * and inline renaming. All edits go through the adapter inside store.mutate().
 *
 * Events: 'zoom' (zoom factor), 'tool' (tool name), 'link' ({ from, to }), 'error' (message).
 */
export class DiagramView extends EventBus {
  constructor({ canvas, world, marquee, hint, store, settings, getAdapter }) {
    super();
    this.canvas = canvas;
    this.world = world;
    this.marquee = marquee;
    this.hint = hint;
    this.store = store;
    this.settings = settings;
    this.getAdapter = getAdapter;
    this.renderer = new DiagramRenderer(world, { showTypes: settings.get('showRowTypes') });
    this.rubber = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.rubber.setAttribute('class', 'rubber');
    this.rubber.innerHTML = '<path class="rubber__line" d=""/>';
    world.append(this.rubber);
    this.viewStates = { cdm: { x: 40, y: 40, z: 1 }, ldm: { x: 40, y: 40, z: 1 }, pdm: { x: 40, y: 40, z: 1 } };
    this.tool = 'select';
    this.linkFrom = null;
    this.gesture = null;
    this.spaceDown = false;
    this.editor = null;
    this.issues = [];
    this.bind();
  }

  get adapter() { return this.getAdapter(); }
  get view() { return this.viewStates[this.store.activeModel]; }
  get selection() { return this.store.selection; }

  // ---------- rendering ----------

  render() {
    this.closeEditor(false);
    this.renderer.showTypes = this.settings.get('showRowTypes');
    this.renderer.render(this.adapter);
    this.renderer.applySelection(this.selection);
    this.renderer.applyIssues(this.issues);
    this.world.dataset.model = this.store.activeModel;
    if (!this.view.fitted && this.renderer.cache.size && this.canvas.clientWidth) {
      this.view.fitted = true;
      this.fit();
    } else this.applyTransform();
  }

  /** A new document: every model gets fitted to the screen the first time it is shown. */
  resetViews() {
    Object.values(this.viewStates).forEach((v) => Object.assign(v, { x: 40, y: 40, z: 1, fitted: false }));
  }

  setIssues(issues) {
    this.issues = issues;
    this.renderer.applyIssues(issues);
  }

  refreshSelection() { this.renderer.applySelection(this.selection); }

  applyTransform() {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    const grid = this.settings.get('gridSize') * z;
    this.canvas.style.backgroundSize = `${grid}px ${grid}px`;
    this.canvas.style.backgroundPosition = `${x}px ${y}px`;
    this.canvas.style.setProperty('--zoom', z);
    this.emit('zoom', z);
  }

  toWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const { x, y, z } = this.view;
    return { x: (clientX - rect.left - x) / z, y: (clientY - rect.top - y) / z };
  }

  /** Centre of the visible area, in world coordinates (for new tables). */
  visibleCenter() {
    const rect = this.canvas.getBoundingClientRect();
    return this.toWorld(rect.left + rect.width / 2 - 100, rect.top + rect.height / 2 - 60);
  }

  // ---------- zoom & pan ----------

  zoomTo(z, anchor) {
    const rect = this.canvas.getBoundingClientRect();
    const view = this.view;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
    const ax = anchor ? anchor.x - rect.left : rect.width / 2;
    const ay = anchor ? anchor.y - rect.top : rect.height / 2;
    view.x = ax - ((ax - view.x) / view.z) * next;
    view.y = ay - ((ay - view.y) / view.z) * next;
    view.z = next;
    this.applyTransform();
  }

  zoomBy(factor, anchor) { this.zoomTo(this.view.z * factor, anchor); }

  fit() {
    const box = this.renderer.bounds(40);
    if (!box) {
      Object.assign(this.view, { x: 40, y: 40, z: 1 });
      this.applyTransform();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const z = Math.min(1.5, Math.max(MIN_ZOOM, Math.min(rect.width / box.w, rect.height / box.h)));
    this.view.z = Math.round(z * 100) / 100;
    this.view.x = (rect.width - box.w * this.view.z) / 2 - box.x * this.view.z;
    this.view.y = (rect.height - box.h * this.view.z) / 2 - box.y * this.view.z;
    this.applyTransform();
  }

  centerOn({ nodeId, edgeId }) {
    let point = null;
    if (nodeId && this.renderer.cache.get(nodeId)) point = DiagramRenderer.center(this.renderer.cache.get(nodeId));
    else if (edgeId) point = this.renderer.edgeMids.get(edgeId);
    if (!point) return;
    const rect = this.canvas.getBoundingClientRect();
    this.view.x = rect.width / 2 - point.x * this.view.z;
    this.view.y = rect.height / 2 - point.y * this.view.z;
    this.applyTransform();
  }

  // ---------- tools ----------

  setTool(tool) {
    this.tool = tool;
    this.cancelLink();
    this.canvas.dataset.tool = tool;
    this.showHint(tool === 'link' ? 'Click the table that gets the foreign key (or the first class), then the second one. Esc cancels.' : '');
    this.emit('tool', tool);
  }

  showHint(text) {
    this.hint.textContent = text;
    this.hint.hidden = !text;
  }

  cancelLink() {
    if (this.linkFrom) this.renderer.cache.get(this.linkFrom)?.el.classList.remove('is-link-source');
    this.linkFrom = null;
    this.rubber.querySelector('path').setAttribute('d', '');
  }

  /** Escape: cancels the current gesture/tool; returns true if something was cancelled. */
  escape() {
    if (this.editor) { this.closeEditor(false); return true; }
    if (this.linkFrom) {
      this.cancelLink();
      this.showHint('Link cancelled. Click a table to start again, or press V for the select tool.');
      return true;
    }
    if (this.tool !== 'select') { this.setTool('select'); return true; }
    return false;
  }

  // ---------- event wiring ----------

  bind() {
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onHover(e));
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => { if (this.gesture) e.preventDefault(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.isTyping(e.target) && !document.querySelector('.modal-backdrop')) {
        if (!this.spaceDown) { this.spaceDown = true; this.canvas.classList.add('is-grab'); }
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { this.spaceDown = false; this.canvas.classList.remove('is-grab'); }
    });
    window.addEventListener('resize', () => this.applyTransform());
  }

  isTyping(target) {
    const tag = target && target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable);
  }

  hitTest(target) {
    if (target.closest('.inline-edit')) return { type: 'editor' };
    const rowEl = target.closest('.row');
    const nodeEl = target.closest('.node');
    if (rowEl && nodeEl) return { type: 'row', nodeId: nodeEl.dataset.node, rowId: rowEl.dataset.row, el: rowEl };
    if (nodeEl) return { type: 'node', id: nodeEl.dataset.node, el: nodeEl, onTitle: !!target.closest('.node__title') };
    const edgeEl = target.closest('.edge');
    if (edgeEl) return { type: 'edge', id: edgeEl.dataset.edge, el: edgeEl, onLabel: target.classList.contains('edge__label') };
    if (target.closest('.empty, .tool-hint')) return { type: 'ui' };
    return { type: 'canvas' };
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), { x: e.clientX, y: e.clientY });
      return;
    }
    const scale = e.deltaMode === 1 ? 16 : 1;
    this.view.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * scale;
    this.view.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * scale;
    this.applyTransform();
  }

  onHover(e) {
    if (this.tool !== 'link' || !this.linkFrom || this.gesture) return;
    const from = this.renderer.cache.get(this.linkFrom);
    if (!from) return;
    const c = DiagramRenderer.center(from);
    const p = this.toWorld(e.clientX, e.clientY);
    this.rubber.querySelector('path').setAttribute('d', `M${c.x} ${c.y} L${p.x} ${p.y}`);
  }

  onPointerDown(e) {
    const hit = this.hitTest(e.target);
    if (hit.type === 'editor' || hit.type === 'ui') return;
    if (this.editor) this.closeEditor(true);
    this.canvas.focus({ preventScroll: true });

    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      this.startPan(e);
      return;
    }
    if (e.button !== 0) return;

    if (this.tool === 'link') {
      this.onLinkClick(hit);
      return;
    }

    const additive = e.ctrlKey || e.metaKey;
    const extend = e.shiftKey;

    if (hit.type === 'row') {
      const key = Selection.row(hit.nodeId, hit.rowId);
      this.selectOnPress(key, additive, extend);
      if (this.selection.has(key)) this.startRowDrag(e, hit);
      return;
    }
    if (hit.type === 'node') {
      const key = Selection.node(hit.id);
      this.selectOnPress(key, additive, extend);
      if (this.selection.has(key)) this.startNodeDrag(e, key);
      return;
    }
    if (hit.type === 'edge') {
      this.selectOnPress(Selection.edge(hit.id), additive, extend);
      return;
    }
    this.startMarquee(e, additive || extend);
  }

  /** Ctrl toggles, Shift adds, a plain press selects only this item (unless it is part of a group). */
  selectOnPress(key, additive, extend) {
    if (additive) this.selection.toggle(key);
    else if (extend) this.selection.add([key]);
    else if (!this.selection.has(key)) this.selection.set([key]);
    this.pendingSingle = !additive && !extend && this.selection.size > 1 ? key : null;
  }

  finishPress(moved) {
    if (!moved && this.pendingSingle) this.selection.set([this.pendingSingle]);
    this.pendingSingle = null;
  }

  track(e, handlers) {
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
      if (!moved) { moved = true; handlers.start?.(ev); }
      handlers.move(ev, start);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.gesture = null;
      handlers.end(ev, moved);
    };
    this.gesture = handlers.name || 'drag';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ---------- pan ----------

  startPan(e) {
    const origin = { x: this.view.x, y: this.view.y };
    this.canvas.classList.add('is-panning');
    this.track(e, {
      name: 'pan',
      move: (ev, start) => {
        this.view.x = origin.x + ev.clientX - start.x;
        this.view.y = origin.y + ev.clientY - start.y;
        this.applyTransform();
      },
      end: () => this.canvas.classList.remove('is-panning')
    });
  }

  // ---------- moving tables ----------

  startNodeDrag(e, pressedKey) {
    const ids = this.selection.nodes();
    const starts = new Map(ids.map((id) => {
      const n = this.renderer.cache.get(id);
      return [id, n ? { x: n.x, y: n.y } : null];
    }).filter(([, p]) => p));
    const lead = starts.get(Selection.parse(pressedKey).id);
    let delta = { x: 0, y: 0 };
    this.track(e, {
      name: 'move',
      start: () => this.canvas.classList.add('is-dragging'),
      move: (ev, start) => {
        const z = this.view.z;
        let dx = (ev.clientX - start.x) / z;
        let dy = (ev.clientY - start.y) / z;
        if (this.settings.get('snapToGrid') && lead && !ev.altKey) {
          const g = this.settings.get('gridSize');
          dx = Math.round((lead.x + dx) / g) * g - lead.x;
          dy = Math.round((lead.y + dy) / g) * g - lead.y;
        }
        delta = { x: dx, y: dy };
        starts.forEach((p, id) => this.renderer.moveNode(id, { x: p.x + dx, y: p.y + dy }));
        this.renderer.drawEdges();
        this.renderer.applySelection(this.selection);
        this.renderer.applyIssues(this.issues);
      },
      end: (ev, moved) => {
        this.canvas.classList.remove('is-dragging');
        this.finishPress(moved);
        if (!moved || (!delta.x && !delta.y)) return;
        this.moveNodes([...starts.keys()], delta, starts, 'Move');
      }
    });
  }

  /** Stores new positions (CDM and LDM share them) as one undo step. */
  moveNodes(ids, delta, starts = null, label = 'Move') {
    if (!ids.length) return;
    const adapter = this.adapter;
    this.store.mutate(label, () => {
      ids.forEach((id) => {
        const from = starts ? starts.get(id) : adapter.position(id);
        if (from) adapter.setPosition(id, { x: from.x + delta.x, y: from.y + delta.y });
      });
    });
  }

  nudge(dx, dy) {
    const ids = this.selection.nodes();
    if (!ids.length) return;
    const step = this.settings.get('snapToGrid') ? this.settings.get('gridSize') : 10;
    this.moveNodes(ids, { x: dx * step, y: dy * step }, null, 'Nudge');
  }

  // ---------- dragging fields ----------

  startRowDrag(e, hit) {
    let ghost = null;
    let drop = null;
    const clearMarks = () => this.world.querySelectorAll('.drop-before, .drop-end, .drop-target')
      .forEach((el) => el.classList.remove('drop-before', 'drop-end', 'drop-target'));
    this.track(e, {
      name: 'rows',
      start: () => {
        const rows = this.selection.rows();
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        document.body.append(ghost);
        this.canvas.classList.add('is-dragging-rows');
        this.dragRows = rows;
      },
      move: (ev) => {
        const count = this.dragRows.length;
        const first = this.adapter.row(hit.nodeId, hit.rowId);
        ghost.innerHTML = `<i class="fa-solid ${ev.altKey ? 'fa-copy' : 'fa-grip-vertical'}"></i> `
          + `${ev.altKey ? 'Copy' : 'Move'} ${count > 1 ? `${count} ${this.adapter.rowNoun}s` : (first ? first.name : '')}`;
        ghost.style.left = `${ev.clientX + 14}px`;
        ghost.style.top = `${ev.clientY + 10}px`;
        clearMarks();
        drop = this.dropTargetAt(ev.clientX, ev.clientY);
        if (drop) {
          drop.nodeEl.classList.add('drop-target');
          if (drop.beforeEl) drop.beforeEl.classList.add('drop-before');
          else drop.nodeEl.classList.add('drop-end');
        }
      },
      end: (ev, moved) => {
        clearMarks();
        ghost?.remove();
        this.canvas.classList.remove('is-dragging-rows');
        this.finishPress(moved);
        if (!moved || !drop) return;
        const items = this.dragRows;
        const copy = ev.altKey;
        const adapter = this.adapter;
        let created = [];
        const result = this.store.mutate(copy ? 'Copy fields' : 'Move fields', () => {
          const r = adapter.moveRows(items, drop.nodeId, drop.beforeRowId, copy);
          if (r.ok) created = r.ids || null;
          return r;
        });
        if (!result.ok) { this.emit('error', result.error); return; }
        if (created && created.length) this.selection.set(created.map((id) => Selection.row(drop.nodeId, id)));
        else this.selection.set(items.filter((i) => i.nodeId === drop.nodeId).map((i) => Selection.row(i.nodeId, i.rowId)));
      }
    });
  }

  dropTargetAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const nodeEl = el && el.closest('.node');
    if (!nodeEl || !this.canvas.contains(nodeEl)) return null;
    const rowEl = el.closest('.row');
    let beforeEl = null;
    if (rowEl) {
      const box = rowEl.getBoundingClientRect();
      beforeEl = clientY < box.top + box.height / 2 ? rowEl : rowEl.nextElementSibling;
      if (beforeEl && !beforeEl.classList.contains('row')) beforeEl = null;
    }
    return { nodeId: nodeEl.dataset.node, nodeEl, beforeEl, beforeRowId: beforeEl ? beforeEl.dataset.row : null };
  }

  // ---------- marquee ----------

  startMarquee(e, additive) {
    const base = additive ? [...this.selection.keys] : [];
    const rect = this.canvas.getBoundingClientRect();
    const box = { x: e.clientX, y: e.clientY };
    this.track(e, {
      name: 'marquee',
      start: () => { this.marquee.hidden = false; },
      move: (ev) => {
        const x1 = Math.min(box.x, ev.clientX);
        const y1 = Math.min(box.y, ev.clientY);
        const x2 = Math.max(box.x, ev.clientX);
        const y2 = Math.max(box.y, ev.clientY);
        Object.assign(this.marquee.style, {
          left: `${x1 - rect.left}px`, top: `${y1 - rect.top}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px`
        });
        const a = this.toWorld(x1, y1);
        const b = this.toWorld(x2, y2);
        const found = this.itemsInside({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        this.selection.set([...new Set([...base, ...found])]);
        this.renderer.applySelection(this.selection);
      },
      end: (ev, moved) => {
        this.marquee.hidden = true;
        if (!moved && !additive) this.selection.clear();
      }
    });
  }

  /** Tables fully inside are selected whole; tables only crossed contribute the fields inside. */
  itemsInside(r) {
    const keys = [];
    this.renderer.cache.forEach((n, id) => {
      const inside = n.x >= r.x1 && n.y >= r.y1 && n.x + n.w <= r.x2 && n.y + n.h <= r.y2;
      if (inside) { keys.push(Selection.node(id)); return; }
      const crosses = n.x < r.x2 && n.x + n.w > r.x1 && n.y < r.y2 && n.y + n.h > r.y1;
      if (!crosses) return;
      n.rows.forEach((row, rowId) => {
        const top = n.y + row.top;
        if (top < r.y2 && top + row.h > r.y1) keys.push(Selection.row(id, rowId));
      });
    });
    this.renderer.edgeMids.forEach((m, id) => {
      if (m.x >= r.x1 && m.x <= r.x2 && m.y >= r.y1 && m.y <= r.y2) keys.push(Selection.edge(id));
    });
    return keys;
  }

  // ---------- link tool ----------

  onLinkClick(hit) {
    const nodeId = hit.type === 'node' ? hit.id : hit.type === 'row' ? hit.nodeId : null;
    const node = nodeId && this.adapter.nodes().find((n) => n.id === nodeId);
    if (!node || node.variant === 'assocClass') {
      if (node) this.emit('error', 'Association classes are attached to their association. Link the two classes instead.');
      this.cancelLink();
      this.showHint('Click the first table or class.');
      return;
    }
    if (!this.linkFrom) {
      this.linkFrom = nodeId;
      this.renderer.cache.get(nodeId)?.el.classList.add('is-link-source');
      const tip = this.adapter.key === 'cdm' ? 'Now click the second class (the same class makes a reflexive association).'
        : 'Now click the table whose primary key is referenced.';
      this.showHint(tip);
      return;
    }
    const from = this.linkFrom;
    this.cancelLink();
    this.showHint('Click the first table or class of the next link. Esc returns to the select tool.');
    this.emit('link', { from, to: nodeId });
  }

  // ---------- inline rename ----------

  onDoubleClick(e) {
    const hit = this.hitTest(e.target);
    if (this.tool === 'link') return;
    if (hit.type === 'row') this.editRow(hit.nodeId, hit.rowId);
    else if (hit.type === 'node') this.editNode(hit.id);
    else if (hit.type === 'edge') this.emit('focusInspector', 'name');
    else if (hit.type === 'canvas') this.emit('addNodeAt', this.toWorld(e.clientX - 90, e.clientY - 20));
  }

  editNode(id) {
    const n = this.renderer.cache.get(id);
    const node = this.adapter.nodes().find((x) => x.id === id);
    if (!n || !node) return;
    this.selection.set([Selection.node(id)]);
    const titleEl = n.el.querySelector('.node__title');
    this.openEditor(titleEl, node.title, { type: 'node', id }, (value) => this.adapter.renameNode(id, value));
  }

  editRow(nodeId, rowId) {
    const n = this.renderer.cache.get(nodeId);
    const row = this.adapter.row(nodeId, rowId);
    if (!n || !row) return;
    if (row.fk) {
      this.emit('error', 'Foreign key names are generated from their link. Select the arrow to change its verb or role.');
      return;
    }
    this.selection.set([Selection.row(nodeId, rowId)]);
    const el = n.el.querySelector(`[data-row="${CSS.escape(rowId)}"] .row__name`);
    this.openEditor(el, row.name, { type: 'row', nodeId, rowId }, (value) => this.adapter.renameRow(nodeId, rowId, value));
  }

  /** Name the input would become, and its convention issues, while typing. */
  previewName(target, raw) {
    const a = this.adapter;
    const nc = a.nc;
    if (a.key === 'cdm') {
      const kind = target.type === 'row' ? 'attribute' : (a.classOf(target.id) ? 'class' : 'association');
      return a.preview(kind, raw);
    }
    if (target.type === 'node') {
      const table = a.table(target.id);
      return a.preview(table.isAssociation ? 'associationTable' : 'table', raw, { isAssociation: table.isAssociation });
    }
    const table = a.table(target.nodeId);
    const row = a.row(target.nodeId, target.rowId);
    const rest = nc.keepOrLowerCamel(nc.stripKeyPrefix(nc.normalize(a.rowKind, raw)));
    const name = `${TableAdapter.prefixFor(row)}${rest}`;
    return { name, issues: nc.validate(a.rowKind, name, { pk: row.pk, fk: row.fk, isAssociation: table.isAssociation }) };
  }

  openEditor(anchorEl, value, target, commit) {
    this.closeEditor(false);
    const wrap = document.createElement('div');
    wrap.className = 'inline-edit';
    wrap.innerHTML = '<input type="text" spellcheck="false" autocomplete="off"><div class="inline-edit__hint"></div>';
    const input = wrap.querySelector('input');
    const hint = wrap.querySelector('.inline-edit__hint');
    input.value = value;
    anchorEl.classList.add('is-editing');
    anchorEl.append(wrap);
    const update = () => {
      const { name, issues } = this.previewName(target, input.value);
      const err = issues.find((i) => i.level === 'error');
      const warn = issues.find((i) => i.level === 'warning');
      hint.className = `inline-edit__hint${err ? ' is-error' : warn ? ' is-warning' : ''}`;
      if (err) hint.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(err.message)}`;
      else if (name !== input.value.trim()) {
        hint.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Saved as <code>${escapeHtml(name)}</code>${warn ? `<br><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(warn.message)}` : ''}`;
      } else if (warn) hint.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(warn.message)}`;
      else hint.innerHTML = '<i class="fa-solid fa-check"></i> Follows the convention';
    };
    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.closeEditor(true); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeEditor(false); }
      if (e.key === 'Tab' && target.type === 'row') {
        e.preventDefault();
        const next = this.closeEditor(true) ? this.neighbourRow(target, e.shiftKey ? -1 : 1) : null;
        if (next) this.editRow(target.nodeId, next);
      }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (this.editor && this.editor.input === input) this.closeEditor(true); }, 0));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
    this.editor = { wrap, input, anchorEl, commit, original: value, target };
    update();
    input.focus();
    input.select();
  }

  neighbourRow(target, dir) {
    const rows = this.adapter.rowsOf(target.nodeId) || [];
    const i = rows.findIndex((r) => r.id === target.rowId);
    const next = rows[i + dir];
    return next && !next.fk ? next.id : null;
  }

  /** Returns true when the editor is closed (committed or cancelled), false if the value was rejected. */
  closeEditor(commit) {
    const ed = this.editor;
    if (!ed) return true;
    const value = ed.input.value;
    if (commit && value.trim() !== ed.original) {
      const result = this.store.mutate('Rename', () => ed.commit(value));
      if (!result.ok) {
        this.emit('error', result.error);
        if (document.activeElement === ed.input) return false;
      }
    }
    if (this.editor !== ed) return true;
    this.editor = null;
    ed.anchorEl.classList.remove('is-editing');
    ed.wrap.remove();
    this.canvas.focus({ preventScroll: true });
    return true;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
