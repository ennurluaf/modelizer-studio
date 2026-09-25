import { ModelAdapter } from './ModelAdapter.js';

export const CARDINALITIES = ['1', '0..1', '0..n', '1..n'];

/** Conceptual model: classes, attributes, associations and association classes. */
export class CdmAdapter extends ModelAdapter {
  constructor(store) {
    super(store, 'cdm');
  }

  get label() { return 'Conceptual data model'; }
  get nodeNoun() { return 'class'; }
  get rowNoun() { return 'attribute'; }
  get cdm() { return this.doc.cdm; }

  // ---------- reading ----------

  classOf(id) { return this.cdm.classes.find((c) => c.id === id) || null; }
  associationOf(id) { return this.cdm.associations.find((a) => a.id === id) || null; }

  rowsOf(nodeId) {
    const cls = this.classOf(nodeId);
    if (cls) return cls.attributes;
    const assoc = this.associationOf(nodeId);
    return assoc && assoc.associationClass ? assoc.associationClass.attributes : null;
  }

  rowView(a) {
    return { id: a.id, name: a.name, badges: a.identifier ? ['id'] : [], detail: a.unique ? 'unique' : '' };
  }

  nodes() {
    return [
      ...this.cdm.classes.map((c) => ({ id: c.id, title: c.name, variant: 'class', rows: c.attributes.map((a) => this.rowView(a)) })),
      ...this.cdm.associations.filter((a) => a.associationClass).map((a) => ({
        id: a.id, title: a.name, variant: 'assocClass', rows: a.associationClass.attributes.map((x) => this.rowView(x))
      }))
    ];
  }

  edges() {
    return this.cdm.associations.map((a) => ({
      id: a.id,
      kind: 'association',
      from: a.source.classId,
      to: a.target.classId,
      label: a.name,
      fromCard: a.source.cardinality,
      toCard: a.target.cardinality,
      fromRole: a.source.role,
      toRole: a.target.role,
      hasClass: !!a.associationClass
    }));
  }

  defaultPosition(node) {
    if (node.variant !== 'assocClass') return null;
    const assoc = this.associationOf(node.id);
    const a = this.position(assoc.source.classId);
    const b = this.position(assoc.target.classId);
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 150 };
  }

  usedVerbs() { return this.cdm.associations.map((a) => a.name); }
  classNames(exceptId) { return this.cdm.classes.filter((c) => c.id !== exceptId).map((c) => c.name); }
  associationNames(exceptId) { return this.cdm.associations.filter((a) => a.id !== exceptId).map((a) => a.name); }

  // ---------- nodes ----------

  addNode(pos) {
    const name = this.nc.unique('NewClass', [...this.classNames(), ...this.associationNames()]);
    const id = this.uid('cls');
    this.cdm.classes.push({ id, name, attributes: [] });
    this.setPosition(id, pos);
    return ModelAdapter.ok({ id });
  }

  renameNode(id, raw) {
    const cls = this.classOf(id);
    if (cls) {
      const check = this.checkName('class', raw, [...this.classNames(id), ...this.associationNames()]);
      if (check.ok) cls.name = check.name;
      return check;
    }
    const assoc = this.associationOf(id);
    return assoc ? this.renameAssociation(assoc, raw) : ModelAdapter.fail('Nothing to rename.');
  }

  renameAssociation(assoc, raw) {
    const taken = [...this.associationNames(assoc.id), ...(assoc.associationClass ? this.classNames() : [])];
    const check = this.checkName('association', raw, taken);
    if (check.ok) assoc.name = check.name;
    return check;
  }

  removeNodes(ids) {
    if (!ids.length) return;
    const set = new Set(ids);
    this.cdm.associations.forEach((a) => { if (set.has(a.id)) a.associationClass = null; });
    this.cdm.classes = this.cdm.classes.filter((c) => !set.has(c.id));
    this.cdm.associations = this.cdm.associations.filter((a) => !set.has(a.source.classId) && !set.has(a.target.classId));
  }

  removeEdges(ids) {
    const set = new Set(ids);
    this.cdm.associations = this.cdm.associations.filter((a) => !set.has(a.id));
  }

  // ---------- rows ----------

  addRow(nodeId, base = 'newAttribute') {
    const rows = this.rowsOf(nodeId);
    if (!rows) return ModelAdapter.fail('Select a class first.');
    const id = this.uid('att');
    rows.push({ id, name: this.nc.unique(base, rows.map((r) => r.name)), identifier: false, unique: false });
    return ModelAdapter.ok({ id });
  }

  renameRow(nodeId, rowId, raw) {
    const rows = this.rowsOf(nodeId);
    const row = this.row(nodeId, rowId);
    if (!row) return ModelAdapter.fail('Attribute not found.');
    const check = this.checkName('attribute', raw, rows.filter((r) => r.id !== rowId).map((r) => r.name));
    if (check.ok) row.name = check.name;
    return check;
  }

  removeRows(items) {
    items.forEach(({ nodeId, rowId }) => {
      const rows = this.rowsOf(nodeId);
      if (!rows) return;
      const index = rows.findIndex((r) => r.id === rowId);
      if (index >= 0) rows.splice(index, 1);
    });
  }

  exportRows(items) {
    return items.map(({ nodeId, rowId }) => this.row(nodeId, rowId)).filter(Boolean).map((r) => ({
      name: r.name, identifier: r.identifier, pk: r.identifier, fk: false, unique: r.unique, nullable: true, type: ''
    }));
  }

  /** Accepts rows from any model: key prefixes are removed, names converted to lowerCamelCase. */
  importRows(nodeId, rows, beforeRowId) {
    const target = this.rowsOf(nodeId);
    if (!target) return ModelAdapter.fail('Paste fields into a class.');
    const ids = [];
    const created = rows.map((r) => {
      const name = this.nc.unique(this.nc.normalize('attribute', this.nc.stripKeyPrefix(r.name)) || 'newAttribute',
        [...target.map((t) => t.name), ...ids.map((x) => x.name)]);
      const row = { id: this.uid('att'), name, identifier: !!(r.identifier || r.pk) && !r.fk, unique: !!r.unique };
      ids.push(row);
      return row;
    });
    this.insertAt(target, created, beforeRowId);
    return ModelAdapter.ok({ ids: created.map((r) => r.id) });
  }

  // ---------- copy / paste of whole classes ----------

  exportNodes(ids) {
    const set = new Set(ids);
    const classes = this.cdm.classes.filter((c) => set.has(c.id));
    const classIds = new Set(classes.map((c) => c.id));
    const associations = this.cdm.associations.filter((a) => classIds.has(a.source.classId) && classIds.has(a.target.classId));
    const positions = {};
    [...classes, ...associations].forEach((x) => { if (this.position(x.id)) positions[x.id] = this.position(x.id); });
    return { classes, associations, positions };
  }

  importNodes(payload, offset = { x: 40, y: 40 }) {
    const idMap = new Map();
    const newIds = [];
    (payload.classes || []).forEach((c) => {
      const id = this.uid('cls');
      idMap.set(c.id, id);
      newIds.push(id);
      this.cdm.classes.push({
        id,
        name: this.nc.unique(c.name, [...this.classNames(), ...this.associationNames()]),
        attributes: c.attributes.map((a) => ({ ...a, id: this.uid('att') }))
      });
    });
    (payload.associations || []).forEach((a) => {
      const id = this.uid('asc');
      idMap.set(a.id, id);
      this.cdm.associations.push({
        ...a,
        id,
        name: this.nc.unique(a.name, this.associationNames()),
        source: { ...a.source, classId: idMap.get(a.source.classId) },
        target: { ...a.target, classId: idMap.get(a.target.classId) },
        associationClass: a.associationClass ? { attributes: a.associationClass.attributes.map((x) => ({ ...x, id: this.uid('att') })) } : null
      });
    });
    Object.entries(payload.positions || {}).forEach(([oldId, p]) => {
      if (idMap.has(oldId)) this.setPosition(idMap.get(oldId), { x: p.x + offset.x, y: p.y + offset.y });
    });
    return ModelAdapter.ok({ ids: newIds });
  }

  // ---------- associations ----------

  createLink(fromId, toId, values) {
    const check = this.checkName('association', values.name, this.associationNames());
    if (!check.ok) return check;
    const ends = {};
    for (const [end, classId, card, role] of [['source', fromId, values.fromCard, values.fromRole], ['target', toId, values.toCard, values.toRole]]) {
      const cardinality = this.nc.normalizeCardinality(card);
      if (!this.nc.isCardinality(cardinality)) return ModelAdapter.fail(`"${card}" is not a valid cardinality. Use 0, 1 or n separated by "..".`);
      let cleanRole = '';
      if (role && role.trim()) {
        const roleCheck = this.checkName('role', role);
        if (!roleCheck.ok) return roleCheck;
        cleanRole = roleCheck.name;
      }
      ends[end] = { classId, cardinality, role: cleanRole };
    }
    const id = this.uid('asc');
    this.cdm.associations.push({
      id, name: check.name, source: ends.source, target: ends.target,
      associationClass: values.withClass ? { attributes: [] } : null
    });
    return ModelAdapter.ok({ id });
  }

  // ---------- inspector ----------

  inspect(target) {
    if (target.type === 'node') {
      const cls = this.classOf(target.id);
      if (cls) {
        return {
          title: 'Class', icon: 'fa-cube',
          fields: [
            { key: 'name', label: 'Name', type: 'text', kind: 'class', value: cls.name, hint: 'A singular noun in UpperCamelCase.' },
            { key: 'rows', type: 'rows', label: 'Attributes', rows: cls.attributes.map((a) => this.rowView(a)), addLabel: 'Add attribute' }
          ]
        };
      }
      const assoc = this.associationOf(target.id);
      if (!assoc) return null;
      return {
        title: 'Association class', icon: 'fa-link',
        fields: [
          { key: 'name', label: 'Name (same as the association)', type: 'text', kind: 'association', value: assoc.name },
          { key: 'rows', type: 'rows', label: 'Attributes', rows: assoc.associationClass.attributes.map((a) => this.rowView(a)), addLabel: 'Add attribute' }
        ]
      };
    }
    if (target.type === 'row') {
      const row = this.row(target.nodeId, target.rowId);
      if (!row) return null;
      return {
        title: 'Attribute', icon: 'fa-font',
        fields: [
          { key: 'name', label: 'Name', type: 'text', kind: 'attribute', value: row.name, hint: 'A singular noun in lowerCamelCase.' },
          { key: 'identifier', label: 'Identifier (becomes the primary key)', type: 'checkbox', value: row.identifier },
          { key: 'unique', label: 'Unique value', type: 'checkbox', value: row.unique }
        ]
      };
    }
    if (target.type === 'edge') {
      const a = this.associationOf(target.id);
      if (!a) return null;
      const src = this.classOf(a.source.classId);
      const tgt = this.classOf(a.target.classId);
      return {
        title: 'Association', icon: 'fa-arrows-left-right',
        fields: [
          { key: 'name', label: 'Verb', type: 'text', kind: 'association', value: a.name, suggestions: this.suggestVerbs(src.name, tgt.name, []).filter((s) => s !== a.name) },
          { type: 'heading', label: `${src.name} side` },
          { key: 'sourceCard', label: 'Cardinality', type: 'cardinality', value: a.source.cardinality, options: CARDINALITIES },
          { key: 'sourceRole', label: 'Role (optional)', type: 'text', kind: 'role', optional: true, value: a.source.role },
          { type: 'heading', label: `${tgt.name} side` },
          { key: 'targetCard', label: 'Cardinality', type: 'cardinality', value: a.target.cardinality, options: CARDINALITIES },
          { key: 'targetRole', label: 'Role (optional)', type: 'text', kind: 'role', optional: true, value: a.target.role },
          { type: 'heading', label: 'Options' },
          { key: 'associationClass', label: 'Has an association class', type: 'checkbox', value: !!a.associationClass },
          { key: 'swap', label: 'Swap direction', type: 'button', icon: 'fa-right-left' }
        ]
      };
    }
    return null;
  }

  apply(target, key, value) {
    if (target.type === 'node' && key === 'name') return this.renameNode(target.id, value);
    if (target.type === 'row') {
      const row = this.row(target.nodeId, target.rowId);
      if (!row) return ModelAdapter.fail('Attribute not found.');
      if (key === 'name') return this.renameRow(target.nodeId, target.rowId, value);
      if (key === 'identifier' || key === 'unique') {
        row[key] = !!value;
        return ModelAdapter.ok();
      }
    }
    if (target.type === 'edge') {
      const a = this.associationOf(target.id);
      if (!a) return ModelAdapter.fail('Association not found.');
      switch (key) {
        case 'name': return this.renameAssociation(a, value);
        case 'sourceCard':
        case 'targetCard': {
          const card = this.nc.normalizeCardinality(value);
          if (!this.nc.isCardinality(card)) return ModelAdapter.fail(`"${value}" is not a valid cardinality. Use 0, 1 or n separated by "..".`);
          a[key === 'sourceCard' ? 'source' : 'target'].cardinality = card;
          return ModelAdapter.ok();
        }
        case 'sourceRole':
        case 'targetRole': {
          const end = a[key === 'sourceRole' ? 'source' : 'target'];
          if (!String(value || '').trim()) { end.role = ''; return ModelAdapter.ok(); }
          const check = this.checkName('role', value);
          if (check.ok) end.role = check.name;
          return check;
        }
        case 'associationClass':
          a.associationClass = value ? (a.associationClass || { attributes: [] }) : null;
          return ModelAdapter.ok();
        case 'swap':
          [a.source, a.target] = [a.target, a.source];
          return ModelAdapter.ok();
        default: break;
      }
    }
    return ModelAdapter.fail('This property cannot be changed.');
  }

  linkDialogSpec(fromId, toId) {
    const from = this.classOf(fromId);
    const to = this.classOf(toId);
    if (!from || !to) return null;
    return { type: 'association', from, to, suggestions: this.suggestVerbs(from.name, to.name) };
  }
}
