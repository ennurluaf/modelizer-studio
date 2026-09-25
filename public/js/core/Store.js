import { EventBus } from './EventBus.js';
import { DocumentFactory } from './DocumentFactory.js';

/**
 * Selection keys:
 *   node:<nodeId>
 *   row:<nodeId>:<rowId>
 *   edge:<edgeId>
 */
export class Selection extends EventBus {
  constructor() {
    super();
    this.keys = new Set();
  }

  static node(id) { return `node:${id}`; }
  static row(nodeId, rowId) { return `row:${nodeId}:${rowId}`; }
  static edge(id) { return `edge:${id}`; }

  static parse(key) {
    const [type, a, b] = key.split(':');
    if (type === 'row') return { type, nodeId: a, rowId: b };
    return { type, id: a };
  }

  has(key) { return this.keys.has(key); }
  get size() { return this.keys.size; }

  set(keys) {
    this.keys = new Set(keys);
    this.emit('change');
  }

  add(keys) {
    keys.forEach((k) => this.keys.add(k));
    this.emit('change');
  }

  toggle(key) {
    if (this.keys.has(key)) this.keys.delete(key);
    else this.keys.add(key);
    this.emit('change');
  }

  clear() {
    if (!this.keys.size) return;
    this.keys.clear();
    this.emit('change');
  }

  items() { return [...this.keys].map((k) => ({ key: k, ...Selection.parse(k) })); }
  nodes() { return this.items().filter((i) => i.type === 'node').map((i) => i.id); }
  rows() { return this.items().filter((i) => i.type === 'row').map(({ nodeId, rowId }) => ({ nodeId, rowId })); }
  edges() { return this.items().filter((i) => i.type === 'edge').map((i) => i.id); }

  /** Removes keys whose targets no longer exist. */
  prune(exists) {
    const before = this.keys.size;
    this.keys = new Set([...this.keys].filter((k) => exists(Selection.parse(k))));
    if (this.keys.size !== before) this.emit('change');
  }
}

/** Snapshot-based undo/redo. */
export class History {
  constructor(store, limit = 150) {
    this.store = store;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  checkpoint(label) {
    this.undoStack.push({ label, snapshot: JSON.stringify(this.store.doc) });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ label: entry.label, snapshot: JSON.stringify(this.store.doc) });
    this.store.restore(JSON.parse(entry.snapshot));
    return entry.label;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ label: entry.label, snapshot: JSON.stringify(this.store.doc) });
    this.store.restore(JSON.parse(entry.snapshot));
    return entry.label;
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

/** Holds the document, the active model and the selection. Emits "change" after every edit. */
export class Store extends EventBus {
  constructor() {
    super();
    this.doc = DocumentFactory.empty();
    this.activeModel = 'cdm';
    this.serverId = null;
    this.selection = new Selection();
    this.history = new History(this);
    this.dirty = false;
  }

  /**
   * Runs an edit with an undo checkpoint. `fn` may return { ok:false, error } to cancel:
   * the checkpoint is then rolled back and nothing is emitted.
   */
  mutate(label, fn) {
    const before = JSON.stringify(this.doc);
    const result = fn(this.doc);
    if (result && result.ok === false) {
      this.doc = JSON.parse(before);
      return result;
    }
    if (JSON.stringify(this.doc) === before) return result || { ok: true };
    this.history.undoStack.push({ label, snapshot: before });
    if (this.history.undoStack.length > this.history.limit) this.history.undoStack.shift();
    this.history.redoStack = [];
    this.changed(label);
    return result || { ok: true };
  }

  /** For edits that already created their own checkpoint (e.g. drags). */
  changed(label = 'Edit') {
    this.doc.meta.updatedAt = new Date().toISOString();
    this.dirty = true;
    this.emit('change', { label });
  }

  restore(doc) {
    this.doc = doc;
    this.dirty = true;
    this.emit('change', { label: 'restore', restored: true });
  }

  replaceDocument(doc, { serverId = null, label = 'Open' } = {}) {
    this.history.checkpoint(label);
    this.doc = doc;
    this.serverId = serverId;
    this.selection.clear();
    this.emit('change', { label, replaced: true });
  }

  setActiveModel(model) {
    if (model === this.activeModel) return;
    this.activeModel = model;
    this.selection.clear();
    this.emit('model', model);
  }
}
