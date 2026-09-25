import { DocumentFactory } from '../core/DocumentFactory.js';

/**
 * A ModelAdapter turns one model of the document (CDM, LDM or PDM) into generic
 * diagram nodes/rows/edges and performs every edit on it. The view and the inspector
 * only talk to adapters, never to the raw JSON.
 *
 * Every editing method returns { ok: true, ... } or { ok: false, error }.
 */
export class ModelAdapter {
  constructor(store, key) {
    this.store = store;
    this.key = key;
    this.nc = window.Modelizer.NamingConvention;
    this.suggester = new window.Modelizer.LinkNameSuggester(this.nc);
  }

  static ok(data = {}) { return { ok: true, ...data }; }
  static fail(error) { return { ok: false, error }; }

  get doc() { return this.store.doc; }
  get layoutKey() { return 'shared'; }
  get layout() { return this.doc.layout[this.layoutKey]; }
  get nodeNoun() { return 'table'; }
  get rowNoun() { return 'field'; }
  uid(prefix) { return DocumentFactory.uid(prefix); }

  // ---------- positions ----------

  position(id) { return this.layout[id] || null; }

  setPosition(id, pos) {
    this.layout[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
  }

  /** Gives nodes without a stored position a spot on a grid under the existing diagram. */
  ensurePositions(nodes) {
    const missing = nodes.filter((n) => !this.position(n.id));
    if (!missing.length) return;
    const placed = nodes.filter((n) => this.position(n.id)).map((n) => this.position(n.id));
    const startY = placed.length ? Math.max(...placed.map((p) => p.y)) + 260 : 80;
    missing.forEach((node, i) => {
      const fallback = this.defaultPosition(node);
      this.setPosition(node.id, fallback || { x: 80 + (i % 5) * 280, y: startY + Math.floor(i / 5) * 240 });
    });
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  defaultPosition(node) { return null; }

  // ---------- naming helpers ----------

  /** Normalises `raw` to the convention and rejects it when it still breaks a rule or is taken. */
  checkName(kind, raw, taken = [], context = {}) {
    if (kind === 'attribute' && /^(pkfk|pk|fk)_/i.test(String(raw || '').trim())) {
      return ModelAdapter.fail('Keys (pk_, fk_) belong to the logical model, not the conceptual one.');
    }
    const name = this.nc.normalize(kind, raw);
    const errors = this.nc.errors(kind, name, context);
    if (errors.length) return ModelAdapter.fail(errors[0].message);
    if (taken.some((t) => String(t).toLowerCase() === name.toLowerCase())) {
      return ModelAdapter.fail(`"${name}" already exists here. Names must be unique.`);
    }
    return ModelAdapter.ok({ name });
  }

  preview(kind, raw, context = {}) {
    const name = this.nc.normalize(kind, raw);
    return { name, issues: this.nc.validate(kind, name, context) };
  }

  // ---------- rows (generic) ----------

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  rowsOf(nodeId) { return null; }

  row(nodeId, rowId) {
    const rows = this.rowsOf(nodeId);
    return rows ? rows.find((r) => r.id === rowId) || null : null;
  }

  insertAt(rows, items, beforeRowId) {
    const index = beforeRowId ? rows.findIndex((r) => r.id === beforeRowId) : -1;
    if (index < 0) rows.push(...items);
    else rows.splice(index, 0, ...items);
  }

  reorderRows(nodeId, rowIds, beforeRowId) {
    const rows = this.rowsOf(nodeId);
    if (!rows) return ModelAdapter.fail('This item has no fields.');
    const moving = rowIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
    const rest = rows.filter((r) => !rowIds.includes(r.id));
    rows.length = 0;
    rows.push(...rest);
    this.insertAt(rows, moving, beforeRowId && !rowIds.includes(beforeRowId) ? beforeRowId : null);
    return ModelAdapter.ok();
  }

  /** Moves (or copies, when `copy`) rows into another node, e.g. after a drag and drop. */
  moveRows(items, targetNodeId, beforeRowId, copy = false) {
    if (!this.rowsOf(targetNodeId)) return ModelAdapter.fail('Drop the fields on a table.');
    if (!copy && items.every((i) => i.nodeId === targetNodeId)) {
      return this.reorderRows(targetNodeId, items.map((i) => i.rowId), beforeRowId);
    }
    const external = copy ? items : items.filter((i) => i.nodeId !== targetNodeId);
    const exported = this.exportRows(external);
    if (!copy) this.removeRows(external);
    return this.importRows(targetNodeId, exported, beforeRowId);
  }

  removeSelection(selection) {
    this.removeEdges(selection.edges());
    this.removeRows(selection.rows());
    this.removeNodes(selection.nodes());
    return ModelAdapter.ok();
  }

  // ---------- selection helpers ----------

  exists(item) {
    if (item.type === 'node') return !!this.nodes().find((n) => n.id === item.id);
    if (item.type === 'row') return !!this.row(item.nodeId, item.rowId);
    if (item.type === 'edge') return !!this.edges().find((e) => e.id === item.id);
    return false;
  }

  existingNames() { return this.nodes().map((n) => n.title); }

  /** Offers association verb suggestions for two node titles. */
  suggestVerbs(fromTitle, toTitle, exclude = []) {
    return this.suggester.suggest(fromTitle, toTitle, [...this.usedVerbs(), ...exclude]);
  }

  // eslint-disable-next-line class-methods-use-this
  usedVerbs() { return []; }
}
