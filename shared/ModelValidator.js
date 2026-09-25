/**
 * ModelValidator
 * Checks a whole document (CDM + LDM + PDM) against the naming convention.
 * Issue shape: { level, model, nodeId?, rowId?, edgeId?, message }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./NamingConvention'));
  } else {
    root.Modelizer = root.Modelizer || {};
    root.Modelizer.ModelValidator = factory(root.Modelizer.NamingConvention);
  }
})(typeof self !== 'undefined' ? self : this, function (NamingConvention) {
  'use strict';

  class ModelValidator {
    constructor(convention = NamingConvention) {
      this.nc = convention;
    }

    validate(doc) {
      const issues = [];
      if (!doc) return issues;
      this.validateCdm(doc.cdm || {}, issues);
      this.validateLdm(doc.ldm || {}, issues);
      this.validatePdm(doc.pdm || {}, issues);
      return issues;
    }

    push(issues, base, list) {
      list.forEach((i) => issues.push({ ...base, level: i.level, message: i.message }));
    }

    duplicates(items, key = (i) => i.name) {
      const seen = new Map();
      const dups = [];
      items.forEach((item) => {
        const k = String(key(item) || '').toLowerCase();
        if (!k) return;
        if (seen.has(k)) dups.push(item);
        else seen.set(k, item);
      });
      return dups;
    }

    validateCdm(cdm, issues) {
      const classes = cdm.classes || [];
      const associations = cdm.associations || [];
      const model = 'cdm';

      classes.forEach((cls) => {
        this.push(issues, { model, nodeId: cls.id }, this.nc.validate('class', cls.name).map((i) => ({ ...i, message: `${cls.name || 'Class'}: ${i.message}` })));
        (cls.attributes || []).forEach((attr) => {
          this.push(issues, { model, nodeId: cls.id, rowId: attr.id },
            this.nc.validate('attribute', attr.name).map((i) => ({ ...i, message: `${cls.name}.${attr.name}: ${i.message}` })));
        });
        this.duplicates(cls.attributes || []).forEach((attr) => issues.push({
          model, nodeId: cls.id, rowId: attr.id, level: 'error',
          message: `${cls.name}.${attr.name}: attribute names must be unique within a class.`
        }));
      });

      this.duplicates(classes).forEach((cls) => issues.push({
        model, nodeId: cls.id, level: 'error', message: `${cls.name}: class names must be unique in the CDM.`
      }));

      associations.forEach((assoc) => {
        const label = assoc.name || 'association';
        this.push(issues, { model, edgeId: assoc.id },
          this.nc.validate('association', assoc.name).map((i) => ({ ...i, message: `${label}: ${i.message}` })));
        ['source', 'target'].forEach((end) => {
          const card = assoc[end] && assoc[end].cardinality;
          if (!this.nc.isCardinality(card)) {
            issues.push({ model, edgeId: assoc.id, level: 'error', message: `${label}: cardinality "${card || ''}" must use 0, 1, n or * separated by "..".` });
          }
          const role = assoc[end] && assoc[end].role;
          if (role) this.push(issues, { model, edgeId: assoc.id }, this.nc.validate('role', role).map((i) => ({ ...i, message: `${label} role ${role}: ${i.message}` })));
        });
        if (assoc.source && assoc.target && assoc.source.classId === assoc.target.classId && !assoc.source.role && !assoc.target.role) {
          issues.push({ model, edgeId: assoc.id, level: 'warning', message: `${label}: reflexive associations need a role on at least one end.` });
        }
        if (assoc.associationClass) {
          (assoc.associationClass.attributes || []).forEach((attr) => {
            this.push(issues, { model, nodeId: assoc.id, rowId: attr.id },
              this.nc.validate('attribute', attr.name).map((i) => ({ ...i, message: `${label}.${attr.name}: ${i.message}` })));
          });
        }
      });

      this.duplicates(associations).forEach((assoc) => issues.push({
        model, edgeId: assoc.id, level: 'error', message: `${assoc.name}: association names must be unique within the model.`
      }));
      const classNames = new Set(classes.map((c) => c.name.toLowerCase()));
      associations.filter((a) => a.associationClass && classNames.has(String(a.name).toLowerCase())).forEach((a) => issues.push({
        model, nodeId: a.id, level: 'error', message: `${a.name}: an association class name clashes with a class.`
      }));
    }

    validateTableSet(modelKey, tables, rowKey, issues) {
      tables.forEach((table) => {
        const context = { isAssociation: !!table.isAssociation };
        this.push(issues, { model: modelKey, nodeId: table.id },
          this.nc.validate('table', table.name, context).map((i) => ({ ...i, message: `${table.name || 'Table'}: ${i.message}` })));
        const rows = table[rowKey] || [];
        if (!rows.some((r) => r.pk)) {
          issues.push({ model: modelKey, nodeId: table.id, level: 'error', message: `${table.name}: every table needs a primary key.` });
        }
        rows.forEach((row) => {
          this.push(issues, { model: modelKey, nodeId: table.id, rowId: row.id },
            this.nc.validate(modelKey === 'pdm' ? 'column' : 'field', row.name, { ...context, pk: !!row.pk, fk: !!row.fk })
              .map((i) => ({ ...i, message: `${table.name}.${row.name}: ${i.message}` })));
          if (modelKey === 'pdm' && !row.type) {
            issues.push({ model: modelKey, nodeId: table.id, rowId: row.id, level: 'error', message: `${table.name}.${row.name}: a data type is required.` });
          }
        });
        this.duplicates(rows).forEach((row) => issues.push({
          model: modelKey, nodeId: table.id, rowId: row.id, level: 'error', message: `${table.name}.${row.name}: names must be unique within a table.`
        }));
      });
      this.duplicates(tables).forEach((t) => issues.push({
        model: modelKey, nodeId: t.id, level: 'error', message: `${t.name}: table names must be unique.`
      }));
    }

    validateLdm(ldm, issues) {
      this.validateTableSet('ldm', ldm.tables || [], 'fields', issues);
    }

    validatePdm(pdm, issues) {
      this.validateTableSet('pdm', pdm.tables || [], 'columns', issues);
      (pdm.constraints || []).forEach((c) => {
        this.push(issues, { model: 'pdm', edgeId: c.id },
          this.nc.validate('constraint', c.name).map((i) => ({ ...i, message: `${c.name || 'constraint'}: ${i.message}` })));
      });
      (pdm.tables || []).forEach((t) => (t.indexes || []).forEach((idx) => {
        this.push(issues, { model: 'pdm', nodeId: t.id },
          this.nc.validate('index', idx.name).map((i) => ({ ...i, message: `${t.name} index ${idx.name}: ${i.message}` })));
      }));
      this.duplicates(pdm.constraints || []).forEach((c) => issues.push({
        model: 'pdm', edgeId: c.id, level: 'error', message: `${c.name}: constraint names must be unique.`
      }));
    }
  }

  return ModelValidator;
});
