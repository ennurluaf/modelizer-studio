'use strict';

const NamingConvention = require('../../../shared/NamingConvention');

/**
 * Base class for every model-to-model transformation.
 * Subclasses implement apply(doc) and mutate the cloned document they receive.
 */
class Transformer {
  constructor(convention = NamingConvention) {
    this.nc = convention;
  }

  /** Template method: never mutates the caller's document. */
  transform(doc) {
    const copy = Transformer.clone(doc);
    this.apply(copy);
    copy.meta.updatedAt = new Date().toISOString();
    return copy;
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  apply(doc) {
    throw new Error(`${this.constructor.name} must implement apply(doc)`);
  }

  static clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** "0..n" -> Infinity, "1" -> 1, "0..1" -> 1 */
  static maxOf(cardinality) {
    const parts = String(cardinality || '').split('..');
    const last = parts[parts.length - 1].trim();
    if (last === 'n' || last === '*' || last === '') return Infinity;
    const number = Number(last);
    return Number.isFinite(number) ? number : Infinity;
  }

  static minOf(cardinality) {
    const first = String(cardinality || '').split('..')[0].trim();
    const number = Number(first);
    return Number.isFinite(number) ? number : 0;
  }

  /** A single pk named pk_<table> that is not a foreign key is a surrogate key. */
  isSurrogate(row, table, rowKey) {
    const pks = table[rowKey].filter((r) => r.pk);
    return row.pk && !row.fk && pks.length === 1 && row.name === this.nc.pkName(table.name);
  }

  /** Places nodes that have no position yet on a grid below/right of the existing diagram. */
  static placeMissing(layout, ids, near = null) {
    const existing = Object.values(layout);
    const startY = existing.length ? Math.max(...existing.map((p) => p.y)) + 260 : 80;
    let column = 0;
    ids.forEach((id) => {
      if (layout[id]) return;
      if (near && near[id]) {
        layout[id] = { ...near[id] };
        return;
      }
      layout[id] = { x: 80 + (column % 5) * 260, y: startY + Math.floor(column / 5) * 220 };
      column += 1;
    });
  }
}

module.exports = Transformer;
