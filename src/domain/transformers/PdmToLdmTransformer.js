'use strict';

const Transformer = require('./Transformer');

/**
 * PDM -> LDM (reverse engineering, first step)
 *  - columns become fields (types are dropped, key flags kept)
 *  - constraints become links; the verb and role are read from the constraint
 *    or, failing that, from the fk_<table>_<verb>_<role> column name
 *  - a table whose primary key consists only of foreign keys (>= 2) is an association table
 */
class PdmToLdmTransformer extends Transformer {
  apply(doc) {
    const constraints = doc.pdm.constraints || [];
    const tables = doc.pdm.tables.map((t) => ({
      id: t.id,
      name: t.name,
      isAssociation: t.isAssociation || this.looksLikeAssociation(t),
      fields: t.columns.map((c) => ({
        id: c.id, name: c.name, pk: c.pk, fk: c.fk, nullable: c.pk ? false : c.nullable, unique: c.unique
      }))
    }));
    const byId = new Map(tables.map((t) => [t.id, t]));

    const links = constraints
      .filter((c) => byId.has(c.fromTableId) && byId.has(c.toTableId))
      .map((c) => {
        const from = byId.get(c.fromTableId);
        const to = byId.get(c.toTableId);
        const { verb, role } = this.readVerbAndRole(c, from, to);
        return {
          id: c.id, name: verb, role, fromTableId: from.id, toTableId: to.id, fromIds: [...c.fromIds], toIds: [...c.toIds]
        };
      });

    doc.ldm = { tables, links };
    Transformer.placeMissing(doc.layout.shared, tables.map((t) => t.id), doc.layout.pdm);
  }

  // eslint-disable-next-line class-methods-use-this
  looksLikeAssociation(table) {
    const pks = table.columns.filter((c) => c.pk);
    return pks.length >= 2 && pks.every((c) => c.fk);
  }

  readVerbAndRole(constraint, from, to) {
    if (from.isAssociation) {
      const column = from.fields.find((f) => f.id === constraint.fromIds[0]);
      const parsed = this.nc.parseKeyName(column ? column.name : '', { association: true });
      return { verb: from.name, role: constraint.role || parsed.role };
    }
    if (constraint.verb) return { verb: constraint.verb, role: constraint.role || '' };

    // fkc_Source_verb_Target_role
    const prefix = `fkc_${from.name}_`;
    const marker = `_${to.name}`;
    const name = constraint.name || '';
    if (name.startsWith(prefix) && name.includes(marker, prefix.length - 1)) {
      const middle = name.slice(prefix.length, name.indexOf(marker, prefix.length - 1));
      const tail = name.slice(name.indexOf(marker, prefix.length - 1) + marker.length).replace(/^_/, '');
      if (middle) return { verb: middle, role: constraint.role || tail };
    }
    const column = from.fields.find((f) => f.id === constraint.fromIds[0]);
    const parsed = this.nc.parseKeyName(column ? column.name : '');
    return { verb: parsed.verb, role: constraint.role || parsed.role };
  }
}

module.exports = PdmToLdmTransformer;
