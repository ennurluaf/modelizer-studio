'use strict';

const Transformer = require('./Transformer');
const LinkNameSuggester = require('../../../shared/LinkNameSuggester');

/**
 * LDM -> CDM (reverse engineering, second step)
 *  - surrogate keys (pk_<table>) disappear, natural keys become identifier attributes
 *  - foreign keys become associations; the verb comes from the link or from fk_<table>_<verb>
 *  - an association table with exactly two foreign keys becomes an n..m association;
 *    its remaining fields become the attributes of an association class
 */
class LdmToCdmTransformer extends Transformer {
  constructor(convention) {
    super(convention);
    this.suggester = new LinkNameSuggester(this.nc);
  }

  apply(doc) {
    const { tables, links } = doc.ldm;
    const byId = new Map(tables.map((t) => [t.id, t]));
    const linksFrom = new Map();
    links.forEach((l) => {
      if (!linksFrom.has(l.fromTableId)) linksFrom.set(l.fromTableId, []);
      linksFrom.get(l.fromTableId).push(l);
    });

    const associationTables = new Set(
      tables.filter((t) => this.isAssociationTable(t, linksFrom.get(t.id) || [])).map((t) => t.id)
    );

    const classes = tables
      .filter((t) => !associationTables.has(t.id))
      .map((t) => this.classFromTable(t));
    const classIds = new Set(classes.map((c) => c.id));
    const associations = [];
    const usedNames = () => associations.map((a) => a.name);

    tables.filter((t) => classIds.has(t.id)).forEach((table) => {
      (linksFrom.get(table.id) || []).forEach((link) => {
        const target = byId.get(link.toTableId);
        if (!target || !classIds.has(target.id)) return;
        const fields = table.fields.filter((f) => link.fromIds.includes(f.id));
        const parsed = this.nc.parseKeyName(fields[0] ? fields[0].name : '');
        const verb = this.pickVerb(link.name || parsed.verb, table.name, target.name, usedNames());
        const nullable = fields.length ? fields.every((f) => f.nullable) : true;
        const unique = fields.length ? fields.every((f) => f.unique) : false;
        associations.push({
          id: link.id,
          name: verb,
          source: { classId: table.id, cardinality: unique ? '0..1' : '0..n', role: '' },
          target: { classId: target.id, cardinality: nullable ? '0..1' : '1', role: this.nc.normalize('role', link.role || parsed.role) },
          associationClass: null
        });
      });
    });

    tables.filter((t) => associationTables.has(t.id)).forEach((table) => {
      const [first, second] = linksFrom.get(table.id);
      const keyIds = new Set([...first.fromIds, ...second.fromIds]);
      const extras = table.fields.filter((f) => !keyIds.has(f.id));
      const roleOf = (link) => {
        const field = table.fields.find((f) => f.id === link.fromIds[0]);
        return this.nc.normalize('role', link.role || this.nc.parseKeyName(field ? field.name : '', { association: true }).role);
      };
      const firstTarget = byId.get(first.toTableId);
      const secondTarget = byId.get(second.toTableId);
      associations.push({
        id: table.id,
        name: this.pickVerb(table.name, firstTarget.name, secondTarget.name, usedNames()),
        source: { classId: first.toTableId, cardinality: '0..n', role: roleOf(first) },
        target: { classId: second.toTableId, cardinality: '0..n', role: roleOf(second) },
        associationClass: extras.length ? { attributes: extras.map((f) => this.attributeFromField(f)) } : null
      });
    });

    doc.cdm = { classes, associations };
  }

  isAssociationTable(table, outgoing) {
    if (outgoing.length !== 2) return false;
    const pkIds = new Set(table.fields.filter((f) => f.pk).map((f) => f.id));
    const fkIds = outgoing.flatMap((l) => l.fromIds);
    const keysArePrimary = fkIds.length > 0 && fkIds.every((id) => pkIds.has(id));
    const primaryAreKeys = [...pkIds].every((id) => fkIds.includes(id));
    return (table.isAssociation || keysArePrimary) && primaryAreKeys;
  }

  classFromTable(table) {
    const attributes = table.fields
      .filter((f) => !f.fk && !this.isSurrogate(f, table, 'fields'))
      .map((f) => this.attributeFromField(f));
    return { id: table.id, name: this.nc.normalize('class', table.name), attributes };
  }

  attributeFromField(field) {
    return {
      id: field.id,
      name: this.nc.normalize('attribute', this.nc.stripKeyPrefix(field.name)),
      identifier: !!field.pk && !field.fk,
      unique: !!field.unique && !field.pk
    };
  }

  pickVerb(candidate, sourceName, targetName, used) {
    const verb = candidate ? this.nc.normalize('association', candidate) : '';
    if (verb && !used.some((u) => u.toLowerCase() === verb.toLowerCase())) return verb;
    if (verb) return this.nc.unique(verb, used);
    return this.suggester.suggest(sourceName, targetName, used, 1)[0] || this.nc.unique('concerns', used);
  }
}

module.exports = LdmToCdmTransformer;
