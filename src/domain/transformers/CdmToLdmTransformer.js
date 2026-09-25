'use strict';

const Transformer = require('./Transformer');

/**
 * CDM -> LDM
 *  - every class becomes a table (same id, so CDM and LDM share their diagram position)
 *  - identifier attributes become pk_<attribute>, otherwise a surrogate pk_<class> is created
 *  - 1..n  : the "many" side receives fk_<referredTable>_<verb>[_<role>]
 *  - 1..1  : the optional side receives a unique foreign key
 *  - n..m  : an association table named after the association, with pkfk_<table>[_<role>] keys
 *  - association class attributes move to the table that carries the relationship
 */
class CdmToLdmTransformer extends Transformer {
  apply(doc) {
    const tables = new Map();
    const links = [];
    doc.cdm.classes.forEach((cls) => tables.set(cls.id, this.tableFromClass(cls)));
    doc.cdm.associations.forEach((assoc) => {
      const source = tables.get(assoc.source.classId);
      const target = tables.get(assoc.target.classId);
      if (!source || !target) return;
      const manyToMany = Transformer.maxOf(assoc.source.cardinality) > 1 && Transformer.maxOf(assoc.target.cardinality) > 1;
      if (manyToMany) this.mapManyToMany(assoc, source, target, tables, links, doc.layout.shared);
      else this.mapToOne(assoc, source, target, links);
    });
    doc.ldm = { tables: [...tables.values()], links };
    Transformer.placeMissing(doc.layout.shared, doc.ldm.tables.map((t) => t.id));
  }

  tableFromClass(cls) {
    const identifiers = cls.attributes.filter((a) => a.identifier);
    const fields = [];
    if (identifiers.length) {
      identifiers.forEach((a) => fields.push(this.field(a.id, this.nc.pkName(a.name), { pk: true, nullable: false })));
    } else {
      fields.push(this.field(`${cls.id}_pk`, this.nc.pkName(cls.name), { pk: true, nullable: false }));
    }
    cls.attributes
      .filter((a) => !a.identifier)
      .forEach((a) => fields.push(this.field(a.id, a.name, { unique: !!a.unique })));
    return { id: cls.id, name: cls.name, isAssociation: false, fields };
  }

  // eslint-disable-next-line class-methods-use-this
  field(id, name, flags = {}) {
    return { id, name, pk: false, fk: false, nullable: true, unique: false, ...flags };
  }

  uniqueName(table, name) {
    return this.nc.unique(name, table.fields.map((f) => f.name));
  }

  mapToOne(assoc, source, target, links) {
    const srcMax = Transformer.maxOf(assoc.source.cardinality);
    const tgtMax = Transformer.maxOf(assoc.target.cardinality);
    let holder = source;
    let referred = target;
    let referredEnd = assoc.target;
    let oneToOne = false;

    if (srcMax <= 1 && tgtMax > 1) {
      holder = target;
      referred = source;
      referredEnd = assoc.source;
    } else if (srcMax <= 1 && tgtMax <= 1) {
      oneToOne = true;
      // The foreign key goes to the side whose partner is mandatory.
      if (Transformer.minOf(assoc.target.cardinality) === 0 && Transformer.minOf(assoc.source.cardinality) >= 1) {
        holder = target;
        referred = source;
        referredEnd = assoc.source;
      }
    }

    const pks = referred.fields.filter((f) => f.pk);
    const nullable = Transformer.minOf(referredEnd.cardinality) === 0;
    const created = pks.map((pk) => {
      const suffix = pks.length > 1 ? `_${this.nc.stripKeyPrefix(pk.name)}` : '';
      const name = this.uniqueName(holder, this.nc.fkName(referred.name, assoc.name, referredEnd.role) + suffix);
      const f = this.field(`${assoc.id}_${pk.id}`, name, { fk: true, nullable, unique: oneToOne });
      holder.fields.push(f);
      return f;
    });

    if (assoc.associationClass) {
      assoc.associationClass.attributes.forEach((a) => holder.fields.push(this.field(a.id, this.uniqueName(holder, a.name))));
    }

    links.push({
      id: assoc.id,
      name: assoc.name,
      role: referredEnd.role || '',
      fromTableId: holder.id,
      toTableId: referred.id,
      fromIds: created.map((f) => f.id),
      toIds: pks.map((f) => f.id)
    });
  }

  mapManyToMany(assoc, source, target, tables, links, layout) {
    const table = { id: assoc.id, name: assoc.name, isAssociation: true, fields: [] };
    const reflexive = source.id === target.id;

    [['source', source], ['target', target]].forEach(([endKey, referred]) => {
      const end = assoc[endKey];
      const role = end.role || (reflexive ? endKey : '');
      const pks = referred.fields.filter((f) => f.pk);
      const created = pks.map((pk) => {
        const suffix = pks.length > 1 ? `_${this.nc.stripKeyPrefix(pk.name)}` : '';
        const name = this.uniqueName(table, this.nc.pkfkName(referred.name, role) + suffix);
        const f = this.field(`${assoc.id}_${endKey}_${pk.id}`, name, { pk: true, fk: true, nullable: false });
        table.fields.push(f);
        return f;
      });
      links.push({
        id: `${assoc.id}_${endKey}`,
        name: assoc.name,
        role,
        fromTableId: table.id,
        toTableId: referred.id,
        fromIds: created.map((f) => f.id),
        toIds: pks.map((f) => f.id)
      });
    });

    if (assoc.associationClass) {
      assoc.associationClass.attributes.forEach((a) => table.fields.push(this.field(a.id, this.uniqueName(table, a.name))));
    }
    tables.set(table.id, table);

    if (!layout[assoc.id] && layout[source.id] && layout[target.id]) {
      layout[assoc.id] = {
        x: Math.round((layout[source.id].x + layout[target.id].x) / 2),
        y: Math.round((layout[source.id].y + layout[target.id].y) / 2) + 140
      };
    }
  }
}

module.exports = CdmToLdmTransformer;
