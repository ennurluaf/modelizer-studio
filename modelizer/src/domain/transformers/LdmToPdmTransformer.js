'use strict';

const Transformer = require('./Transformer');

/**
 * LDM -> PDM
 *  - tables/fields are transposed identically; data types are guessed from the field name
 *    (types chosen earlier in the PDM are kept when a field id still exists)
 *  - foreign key columns take the type of the column they reference
 *  - every link becomes a constraint fkc_<Source>_<verb>_<Target>[_<role>]
 *    (association tables: fkc_<associationTable>_<Target>[_<role>])
 *  - unique fields get an index idx_unique_<field>
 */
class LdmToPdmTransformer extends Transformer {
  /** Rules test the words of the field name: [first word set | null, last word set | null, type]. */
  static get TYPE_RULES() {
    const set = (words) => new Set(words.split(' '));
    return [
      [set('is has can'), null, 'BOOLEAN'],
      [null, set('active enabled visible verified available'), 'BOOLEAN'],
      [null, set('at time timestamp'), 'DATETIME'],
      [null, set('date day on birth birthday'), 'DATE'],
      [null, set('price amount cost salary total fee balance rate'), 'DECIMAL(10,2)'],
      [null, set('count number nr qty quantity age capacity duration minutes seconds year rank size'), 'INT'],
      [null, set('email'), 'VARCHAR(255)'],
      [null, set('hash token url path password'), 'VARCHAR(255)'],
      [null, set('description comment note text content body remark'), 'TEXT'],
      [null, set('code abbreviation symbol'), 'VARCHAR(20)'],
      [null, set('phone mobile fax zip postcode'), 'VARCHAR(30)'],
      [null, set('status state type kind'), 'VARCHAR(30)']
    ];
  }

  apply(doc) {
    const previous = new Map((doc.pdm.tables || []).map((t) => [t.id, t]));
    const tables = doc.ldm.tables.map((t) => this.tableFromLdm(t, previous.get(t.id)));
    const byId = new Map(tables.map((t) => [t.id, t]));

    doc.ldm.links.forEach((link) => {
      const from = byId.get(link.fromTableId);
      const to = byId.get(link.toTableId);
      if (!from || !to) return;
      link.fromIds.forEach((fromId, i) => {
        const column = from.columns.find((c) => c.id === fromId);
        const referenced = to.columns.find((c) => c.id === link.toIds[i]);
        if (column && referenced) {
          column.type = referenced.type;
          column.autoIncrement = false;
        }
      });
    });

    const previousConstraints = new Map((doc.pdm.constraints || []).map((c) => [c.id, c]));
    const names = [];
    const constraints = doc.ldm.links
      .filter((link) => byId.has(link.fromTableId) && byId.has(link.toTableId))
      .map((link) => {
        const from = byId.get(link.fromTableId);
        const to = byId.get(link.toTableId);
        const verb = from.isAssociation ? '' : link.name;
        const name = this.nc.unique(this.nc.constraintName(from.name, verb, to.name, link.role), names);
        names.push(name);
        const prev = previousConstraints.get(link.id);
        return {
          id: link.id,
          name,
          verb: link.name,
          role: link.role || '',
          fromTableId: from.id,
          toTableId: to.id,
          fromIds: [...link.fromIds],
          toIds: [...link.toIds],
          onDelete: prev ? prev.onDelete : (from.isAssociation ? 'CASCADE' : 'RESTRICT'),
          onUpdate: prev ? prev.onUpdate : 'CASCADE'
        };
      });

    tables.forEach((table) => {
      table.indexes = table.columns
        .filter((c) => c.unique && !c.pk)
        .map((c) => ({ id: `${c.id}_idx`, name: this.nc.indexName('unique', c.name), type: 'unique', columnIds: [c.id] }));
    });

    doc.pdm = { tables, constraints };
    Transformer.placeMissing(doc.layout.pdm, tables.map((t) => t.id), doc.layout.shared);
  }

  tableFromLdm(table, previous) {
    const previousColumns = new Map(((previous && previous.columns) || []).map((c) => [c.id, c]));
    const columns = table.fields.map((f) => {
      const prev = previousColumns.get(f.id);
      const surrogate = this.isSurrogate(f, table, 'fields');
      return {
        id: f.id,
        name: f.name,
        type: prev && prev.name === f.name ? prev.type : (surrogate ? 'INT' : this.guessType(f.name)),
        pk: f.pk,
        fk: f.fk,
        nullable: f.pk ? false : (prev ? prev.nullable : f.nullable),
        unique: f.unique,
        autoIncrement: surrogate
      };
    });
    return { id: table.id, name: table.name, isAssociation: table.isAssociation, columns, indexes: [] };
  }

  guessType(fieldName) {
    const words = this.nc.splitWords(this.nc.stripKeyPrefix(fieldName)).map((w) => w.toLowerCase());
    const first = words[0] || '';
    const last = words[words.length - 1] || '';
    const rule = LdmToPdmTransformer.TYPE_RULES.find(([firsts, lasts]) =>
      (firsts && firsts.has(first) && words.length > 1) || (lasts && lasts.has(last)));
    return rule ? rule[2] : 'VARCHAR(100)';
  }
}

module.exports = LdmToPdmTransformer;
