'use strict';

const { DomainError, IdGenerator } = require('./DomainError');

/**
 * One JSON file holds all three models plus the diagram layout:
 * {
 *   format: 'modelizer-document', version: 1,
 *   meta:   { name, language, createdAt, updatedAt },
 *   layout: { shared: { [id]: {x,y} },   // CDM + LDM positions (synced)
 *             pdm:    { [id]: {x,y} } },
 *   cdm: { classes: [], associations: [] },
 *   ldm: { tables: [], links: [] },
 *   pdm: { tables: [], constraints: [] }
 * }
 */
class ModelDocument {
  static get FORMAT() { return 'modelizer-document'; }
  static get VERSION() { return 1; }

  static empty(name = 'Untitled model') {
    const now = new Date().toISOString();
    return {
      format: ModelDocument.FORMAT,
      version: ModelDocument.VERSION,
      meta: { name, language: 'en', createdAt: now, updatedAt: now },
      layout: { shared: {}, pdm: {} },
      cdm: { classes: [], associations: [] },
      ldm: { tables: [], links: [] },
      pdm: { tables: [], constraints: [] }
    };
  }

  /** Parses JSON text or accepts an object, then returns a clean, complete document. */
  static from(input) {
    let raw = input;
    if (typeof input === 'string') {
      try {
        raw = JSON.parse(input);
      } catch (err) {
        throw new DomainError(`The text is not valid JSON: ${err.message}`);
      }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DomainError('A model document must be a JSON object.');
    }
    if (raw.format && raw.format !== ModelDocument.FORMAT) {
      throw new DomainError(`Unknown format "${raw.format}". Expected "${ModelDocument.FORMAT}".`);
    }
    if (!raw.cdm && !raw.ldm && !raw.pdm) {
      throw new DomainError('The document contains no cdm, ldm or pdm section.');
    }
    return new ModelDocument(raw).toJSON();
  }

  constructor(raw) {
    const base = ModelDocument.empty(raw.meta && raw.meta.name);
    this.data = {
      ...base,
      meta: { ...base.meta, ...(raw.meta || {}) },
      layout: {
        shared: ModelDocument.positions(raw.layout && raw.layout.shared),
        pdm: ModelDocument.positions(raw.layout && raw.layout.pdm)
      },
      cdm: this.normalizeCdm(raw.cdm || {}),
      ldm: this.normalizeLdm(raw.ldm || {}),
      pdm: this.normalizePdm(raw.pdm || {})
    };
  }

  static positions(map) {
    const out = {};
    Object.entries(map || {}).forEach(([id, p]) => {
      if (p && Number.isFinite(+p.x) && Number.isFinite(+p.y)) out[id] = { x: +p.x, y: +p.y };
    });
    return out;
  }

  static list(value) { return Array.isArray(value) ? value : []; }
  static str(value, fallback = '') { return value === undefined || value === null ? fallback : String(value); }
  static id(value, prefix) { return value ? String(value) : IdGenerator.next(prefix); }

  normalizeAttributes(list) {
    return ModelDocument.list(list).map((a) => ({
      id: ModelDocument.id(a.id, 'att'),
      name: ModelDocument.str(a.name),
      identifier: !!a.identifier,
      unique: !!a.unique
    }));
  }

  normalizeEnd(end) {
    const e = end || {};
    return {
      classId: ModelDocument.str(e.classId),
      cardinality: ModelDocument.str(e.cardinality, '0..n'),
      role: ModelDocument.str(e.role)
    };
  }

  normalizeCdm(cdm) {
    const classes = ModelDocument.list(cdm.classes).map((c) => ({
      id: ModelDocument.id(c.id, 'cls'),
      name: ModelDocument.str(c.name),
      attributes: this.normalizeAttributes(c.attributes)
    }));
    const classIds = new Set(classes.map((c) => c.id));
    const associations = ModelDocument.list(cdm.associations)
      .map((a) => ({
        id: ModelDocument.id(a.id, 'asc'),
        name: ModelDocument.str(a.name),
        source: this.normalizeEnd(a.source),
        target: this.normalizeEnd(a.target),
        associationClass: a.associationClass
          ? { attributes: this.normalizeAttributes(a.associationClass.attributes) }
          : null
      }))
      .filter((a) => classIds.has(a.source.classId) && classIds.has(a.target.classId));
    return { classes, associations };
  }

  normalizeRows(list, prefix, extra) {
    return ModelDocument.list(list).map((f) => ({
      id: ModelDocument.id(f.id, prefix),
      name: ModelDocument.str(f.name),
      pk: !!f.pk,
      fk: !!f.fk,
      nullable: f.nullable === undefined ? !f.pk : !!f.nullable,
      unique: !!f.unique,
      ...extra(f)
    }));
  }

  normalizeEdgeList(list, tables, rowKey, prefix, extra = () => ({})) {
    const byId = new Map(tables.map((t) => [t.id, t]));
    return ModelDocument.list(list)
      .map((l) => ({
        id: ModelDocument.id(l.id, prefix),
        name: ModelDocument.str(l.name),
        role: ModelDocument.str(l.role),
        fromTableId: ModelDocument.str(l.fromTableId),
        toTableId: ModelDocument.str(l.toTableId),
        fromIds: ModelDocument.list(l.fromIds).map(String),
        toIds: ModelDocument.list(l.toIds).map(String),
        ...extra(l)
      }))
      .filter((l) => byId.has(l.fromTableId) && byId.has(l.toTableId))
      .map((l) => {
        const fromRows = new Set(byId.get(l.fromTableId)[rowKey].map((r) => r.id));
        const toRows = new Set(byId.get(l.toTableId)[rowKey].map((r) => r.id));
        return { ...l, fromIds: l.fromIds.filter((id) => fromRows.has(id)), toIds: l.toIds.filter((id) => toRows.has(id)) };
      });
  }

  normalizeLdm(ldm) {
    const tables = ModelDocument.list(ldm.tables).map((t) => ({
      id: ModelDocument.id(t.id, 'tbl'),
      name: ModelDocument.str(t.name),
      isAssociation: !!t.isAssociation,
      fields: this.normalizeRows(t.fields, 'fld', () => ({}))
    }));
    return { tables, links: this.normalizeEdgeList(ldm.links, tables, 'fields', 'lnk') };
  }

  normalizePdm(pdm) {
    const tables = ModelDocument.list(pdm.tables).map((t) => {
      const columns = this.normalizeRows(t.columns, 'col', (c) => ({
        type: ModelDocument.str(c.type, 'VARCHAR(100)'),
        autoIncrement: !!c.autoIncrement
      }));
      const columnIds = new Set(columns.map((c) => c.id));
      return {
        id: ModelDocument.id(t.id, 'tbl'),
        name: ModelDocument.str(t.name),
        isAssociation: !!t.isAssociation,
        columns,
        indexes: ModelDocument.list(t.indexes).map((i) => ({
          id: ModelDocument.id(i.id, 'idx'),
          name: ModelDocument.str(i.name),
          type: i.type === 'index' ? 'index' : 'unique',
          columnIds: ModelDocument.list(i.columnIds).map(String).filter((id) => columnIds.has(id))
        }))
      };
    });
    const constraints = this.normalizeEdgeList(pdm.constraints, tables, 'columns', 'fkc', (c) => ({
      verb: ModelDocument.str(c.verb),
      onDelete: ModelDocument.str(c.onDelete, 'RESTRICT'),
      onUpdate: ModelDocument.str(c.onUpdate, 'CASCADE')
    }));
    return { tables, constraints };
  }

  toJSON() {
    return this.data;
  }
}

module.exports = ModelDocument;
