import { ModelAdapter } from './ModelAdapter.js';

export const SQL_TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL(10,2)', 'FLOAT', 'BOOLEAN',
  'CHAR(2)', 'VARCHAR(20)', 'VARCHAR(30)', 'VARCHAR(50)', 'VARCHAR(100)', 'VARCHAR(255)', 'TEXT',
  'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'JSON', 'BLOB'
];

/**
 * Shared behaviour of the logical and physical models: tables, key fields and foreign keys.
 * Foreign key names are always derived from their link (fk_<referredTable>_<verb>[_<role>]),
 * so the convention cannot be broken by hand.
 */
export class TableAdapter extends ModelAdapter {
  constructor(store, key, { rowKey, edgeKey, rowKind }) {
    super(store, key);
    this.rowKey = rowKey;
    this.edgeKey = edgeKey;
    this.rowKind = rowKind;
  }

  get model() { return this.doc[this.key]; }
  get tables() { return this.model.tables; }
  get links() { return this.model[this.edgeKey]; }
  get rowNoun() { return this.rowKind; }

  table(id) { return this.tables.find((t) => t.id === id) || null; }
  rowsOf(id) { const t = this.table(id); return t ? t[this.rowKey] : null; }
  link(id) { return this.links.find((l) => l.id === id) || null; }
  tableNames(exceptId) { return this.tables.filter((t) => t.id !== exceptId).map((t) => t.name); }

  // hooks for subclasses
  verbOf(link) { return link.name; }
  setVerb(link, verb) { link.name = verb; }
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  rowDetail(row) { return ''; }
  // eslint-disable-next-line class-methods-use-this
  makeRow(props) {
    return { id: this.uid('fld'), name: '', pk: false, fk: false, nullable: true, unique: false, ...props };
  }
  // eslint-disable-next-line class-methods-use-this
  makeLink(props) { return props; }
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  afterSync(table) {}

  usedVerbs() { return this.links.map((l) => this.verbOf(l)); }

  // ---------- reading ----------

  rowView(row) {
    const badges = [];
    if (row.pk) badges.push('pk');
    if (row.fk) badges.push('fk');
    return { id: row.id, name: row.name, badges, detail: this.rowDetail(row) };
  }

  nodes() {
    return this.tables.map((t) => ({
      id: t.id,
      title: t.name,
      variant: t.isAssociation ? 'assocTable' : 'table',
      rows: t[this.rowKey].map((r) => this.rowView(r))
    }));
  }

  edges() {
    return this.links.map((l) => ({
      id: l.id,
      kind: 'fk',
      from: l.fromTableId,
      to: l.toTableId,
      fromRow: l.fromIds[0],
      toRow: l.toIds[0],
      label: this.verbOf(l),
      title: this.edgeTitle(l)
    }));
  }

  edgeTitle(link) {
    const from = this.table(link.fromTableId);
    const to = this.table(link.toTableId);
    return `${from ? from.name : '?'} → ${to ? to.name : '?'} (${this.verbOf(link) || 'link'})`;
  }

  // ---------- key naming ----------

  static prefixFor(row) {
    if (row.pk && row.fk) return 'pkfk_';
    if (row.pk) return 'pk_';
    if (row.fk) return 'fk_';
    return '';
  }

  uniqueRowName(table, name, row) {
    return this.nc.unique(name, table[this.rowKey].filter((r) => r !== row).map((r) => r.name));
  }

  /** Re-derives every foreign key name, fk flags, and (PDM) constraint names, types and indexes. */
  syncKeys() {
    const fkIds = new Set(this.links.flatMap((l) => l.fromIds));
    this.tables.forEach((t) => t[this.rowKey].forEach((r) => { r.fk = fkIds.has(r.id); }));
    this.links.forEach((link) => {
      const from = this.table(link.fromTableId);
      const to = this.table(link.toTableId);
      if (!from || !to) return;
      const referenced = link.toIds.map((id) => to[this.rowKey].find((r) => r.id === id));
      const rows = link.fromIds.map((id) => from[this.rowKey].find((r) => r.id === id)).filter(Boolean);
      rows.forEach((row, i) => {
        const suffix = rows.length > 1 && referenced[i] ? `_${this.nc.stripKeyPrefix(referenced[i].name)}` : '';
        const base = row.pk || from.isAssociation
          ? this.nc.pkfkName(to.name, link.role)
          : this.nc.fkName(to.name, this.verbOf(link), link.role);
        if (from.isAssociation && !row.pk) {
          row.pk = true;
          row.nullable = false;
        }
        row.name = this.uniqueRowName(from, base + suffix, row);
        if (referenced[i] && referenced[i].type) row.type = referenced[i].type;
      });
    });
    this.tables.forEach((t) => this.afterSync(t));
  }

  // ---------- tables ----------

  addNode(pos) {
    const name = this.nc.unique('NewTable', this.tableNames());
    const id = this.uid('tbl');
    this.tables.push({
      id, name, isAssociation: false,
      [this.rowKey]: [this.makeRow({ name: this.nc.pkName(name), pk: true, nullable: false, ...this.surrogateProps() })],
      ...this.extraTableProps()
    });
    this.setPosition(id, pos);
    return ModelAdapter.ok({ id });
  }

  // eslint-disable-next-line class-methods-use-this
  surrogateProps() { return {}; }
  // eslint-disable-next-line class-methods-use-this
  extraTableProps() { return {}; }

  renameNode(id, raw) {
    const table = this.table(id);
    if (!table) return ModelAdapter.fail('Table not found.');
    const kind = table.isAssociation ? 'associationTable' : 'table';
    const check = this.checkName(kind, raw, this.tableNames(id), { isAssociation: table.isAssociation });
    if (!check.ok) return check;
    const oldPk = this.nc.pkName(table.name);
    table.name = check.name;
    table[this.rowKey].forEach((r) => {
      if (r.pk && !r.fk && r.name === oldPk) r.name = this.uniqueRowName(table, this.nc.pkName(check.name), r);
    });
    this.syncKeys();
    return check;
  }

  setAssociation(table, value) {
    table.isAssociation = !!value;
    const conv = this.nc.normalize(value ? 'associationTable' : 'table', table.name);
    table.name = this.nc.unique(conv, this.tableNames(table.id));
    this.syncKeys();
    return ModelAdapter.ok();
  }

  removeNodes(ids) {
    if (!ids.length) return;
    const set = new Set(ids);
    const dropped = this.links.filter((l) => set.has(l.fromTableId) || set.has(l.toTableId)).map((l) => l.id);
    this.removeEdges(dropped);
    this.model.tables = this.tables.filter((t) => !set.has(t.id));
  }

  /** Removing a link also removes the foreign key fields it created. */
  removeEdges(ids) {
    if (!ids.length) return;
    const set = new Set(ids);
    const removedRows = new Set(this.links.filter((l) => set.has(l.id)).flatMap((l) => l.fromIds));
    this.model[this.edgeKey] = this.links.filter((l) => !set.has(l.id));
    this.tables.forEach((t) => { t[this.rowKey] = t[this.rowKey].filter((r) => !removedRows.has(r.id)); });
    this.pruneLinks();
    this.syncKeys();
  }

  /** Drops links that point at rows which no longer exist. */
  pruneLinks() {
    const rowIds = new Set(this.tables.flatMap((t) => t[this.rowKey].map((r) => r.id)));
    this.model[this.edgeKey] = this.links.filter((l) => l.fromIds.length && l.toIds.length
      && l.fromIds.every((id) => rowIds.has(id)) && l.toIds.every((id) => rowIds.has(id)));
  }

  // ---------- rows ----------

  addRow(nodeId, base = 'newField') {
    const table = this.table(nodeId);
    if (!table) return ModelAdapter.fail('Select a table first.');
    const row = this.makeRow({ name: this.uniqueRowName(table, base) });
    table[this.rowKey].push(row);
    this.afterSync(table);
    return ModelAdapter.ok({ id: row.id });
  }

  renameRow(nodeId, rowId, raw) {
    const table = this.table(nodeId);
    const row = this.row(nodeId, rowId);
    if (!row) return ModelAdapter.fail('Field not found.');
    if (row.fk) return ModelAdapter.fail('Foreign key names come from their link. Select the arrow and change its verb or role instead.');
    const rest = this.nc.stripKeyPrefix(this.nc.normalize(this.rowKind, raw));
    const name = `${TableAdapter.prefixFor(row)}${this.nc.keepOrLowerCamel(rest)}`;
    const check = this.checkName(this.rowKind, name, table[this.rowKey].filter((r) => r !== row).map((r) => r.name),
      { pk: row.pk, fk: row.fk, isAssociation: table.isAssociation });
    if (!check.ok) return check;
    row.name = check.name;
    this.syncKeys();
    return check;
  }

  setPrimary(table, row, value) {
    row.pk = !!value;
    if (row.pk) row.nullable = false;
    if (!row.fk) {
      const rest = this.nc.keepOrLowerCamel(this.nc.stripKeyPrefix(row.name));
      row.name = this.uniqueRowName(table, `${TableAdapter.prefixFor(row)}${rest}`, row);
    }
    this.syncKeys();
    return ModelAdapter.ok();
  }

  removeRows(items) {
    if (!items.length) return;
    const byTable = new Map();
    items.forEach(({ nodeId, rowId }) => {
      if (!byTable.has(nodeId)) byTable.set(nodeId, new Set());
      byTable.get(nodeId).add(rowId);
    });
    byTable.forEach((ids, tableId) => {
      const table = this.table(tableId);
      if (table) table[this.rowKey] = table[this.rowKey].filter((r) => !ids.has(r.id));
    });
    this.pruneLinks();
    this.syncKeys();
  }

  exportRows(items) {
    return items.map(({ nodeId, rowId }) => this.row(nodeId, rowId)).filter(Boolean).map((r) => ({
      name: r.name, pk: r.pk, fk: r.fk, identifier: r.pk && !r.fk, unique: r.unique, nullable: r.nullable, type: r.type || ''
    }));
  }

  /** Pasted/dropped rows keep pk and data type; foreign keys become plain fields (they have no link here). */
  importRows(nodeId, rows, beforeRowId) {
    const table = this.table(nodeId);
    if (!table) return ModelAdapter.fail('Paste fields into a table.');
    const created = [];
    rows.forEach((r) => {
      const pk = !!(r.pk || r.identifier) && !r.fk;
      let rest = this.nc.stripKeyPrefix(r.name);
      if (r.fk) rest = this.nc.toLowerCamel(rest);
      const base = `${pk ? 'pk_' : ''}${this.nc.keepOrLowerCamel(rest) || 'newField'}`;
      const row = this.makeRow({ name: '', pk, nullable: pk ? false : r.nullable !== false, unique: !!r.unique, ...this.importedRowProps(r) });
      row.name = this.nc.unique(base, [...table[this.rowKey].map((x) => x.name), ...created.map((x) => x.name)]);
      created.push(row);
    });
    this.insertAt(table[this.rowKey], created, beforeRowId);
    this.syncKeys();
    return ModelAdapter.ok({ ids: created.map((r) => r.id) });
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  importedRowProps(row) { return {}; }

  // ---------- copy / paste of whole tables ----------

  exportNodes(ids) {
    const set = new Set(ids);
    const tables = this.tables.filter((t) => set.has(t.id));
    const links = this.links.filter((l) => set.has(l.fromTableId) && set.has(l.toTableId));
    const positions = {};
    tables.forEach((t) => { if (this.position(t.id)) positions[t.id] = this.position(t.id); });
    return { tables, links, positions };
  }

  importNodes(payload, offset = { x: 40, y: 40 }) {
    const idMap = new Map();
    const newIds = [];
    (payload.tables || []).forEach((t) => {
      const id = this.uid('tbl');
      idMap.set(t.id, id);
      newIds.push(id);
      const rows = t[this.rowKey] || [];
      rows.forEach((r) => idMap.set(r.id, this.uid('fld')));
      this.tables.push({
        ...t,
        id,
        name: this.nc.unique(t.name, this.tableNames()),
        [this.rowKey]: rows.map((r) => ({ ...r, id: idMap.get(r.id) })),
        ...(t.indexes ? { indexes: [] } : {})
      });
    });
    (payload.links || []).forEach((l) => {
      this.links.push({
        ...l,
        id: this.uid('lnk'),
        fromTableId: idMap.get(l.fromTableId),
        toTableId: idMap.get(l.toTableId),
        fromIds: l.fromIds.map((id) => idMap.get(id)),
        toIds: l.toIds.map((id) => idMap.get(id))
      });
    });
    Object.entries(payload.positions || {}).forEach(([oldId, p]) => {
      if (idMap.has(oldId)) this.setPosition(idMap.get(oldId), { x: p.x + offset.x, y: p.y + offset.y });
    });
    this.pruneLinks();
    this.syncKeys();
    return ModelAdapter.ok({ ids: newIds });
  }

  // ---------- links (foreign keys) ----------

  linkDialogSpec(fromId, toId) {
    const from = this.table(fromId);
    const to = this.table(toId);
    if (!from || !to) return null;
    return { type: 'foreignKey', from, to, suggestions: this.suggestVerbs(from.name, to.name) };
  }

  createLink(fromId, toId, values) {
    const from = this.table(fromId);
    const to = this.table(toId);
    const pks = to[this.rowKey].filter((r) => r.pk);
    if (!pks.length) return ModelAdapter.fail(`${to.name} has no primary key to reference.`);
    let verb = '';
    if (!from.isAssociation) {
      const check = this.checkName('association', values.verb);
      if (!check.ok) return check;
      verb = check.name;
    }
    let role = '';
    if (values.role && values.role.trim()) {
      const check = this.checkName('role', values.role);
      if (!check.ok) return check;
      role = check.name;
    }
    const rows = pks.map((pk) => this.makeRow({
      name: 'fk_tmp', fk: true, pk: from.isAssociation,
      nullable: from.isAssociation ? false : !values.required, unique: !!values.unique, type: pk.type
    }));
    const lastPk = from[this.rowKey].map((r) => r.pk).lastIndexOf(true);
    if (from.isAssociation) from[this.rowKey].splice(lastPk + 1, 0, ...rows);
    else from[this.rowKey].push(...rows);
    const link = this.makeLink({
      id: this.uid('lnk'), name: verb, role, fromTableId: from.id, toTableId: to.id,
      fromIds: rows.map((r) => r.id), toIds: pks.map((r) => r.id)
    }, verb);
    this.links.push(link);
    this.syncKeys();
    return ModelAdapter.ok({ id: link.id });
  }

  // ---------- inspector ----------

  inspectTable(table) {
    return {
      title: table.isAssociation ? 'Association table' : 'Table', icon: 'fa-table',
      fields: [
        { key: 'name', label: 'Name', type: 'text', kind: table.isAssociation ? 'associationTable' : 'table', context: { isAssociation: table.isAssociation }, value: table.name },
        { key: 'isAssociation', label: 'Association table (named after its verb)', type: 'checkbox', value: table.isAssociation },
        { key: 'rows', type: 'rows', label: this.rowKind === 'column' ? 'Columns' : 'Fields', rows: table[this.rowKey].map((r) => this.rowView(r)), addLabel: `Add ${this.rowKind}` }
      ]
    };
  }

  inspectRow(table, row) {
    return {
      title: this.rowKind === 'column' ? 'Column' : 'Field', icon: 'fa-grip-lines',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text', kind: this.rowKind, value: row.name, readonly: row.fk,
          context: { pk: row.pk, fk: row.fk, isAssociation: table.isAssociation },
          hint: row.fk ? 'Generated from the link: fk_<referredTable>_<verb>_<role>.' : 'Key prefixes are added for you.'
        },
        { key: 'pk', label: 'Part of the primary key', type: 'checkbox', value: row.pk, readonly: row.fk && table.isAssociation },
        { key: 'fk', label: 'Foreign key (create it with the link tool)', type: 'checkbox', value: row.fk, readonly: true },
        { key: 'nullable', label: 'Nullable', type: 'checkbox', value: row.nullable, readonly: row.pk },
        { key: 'unique', label: 'Unique', type: 'checkbox', value: row.unique, readonly: row.pk }
      ]
    };
  }

  inspectLink(link) {
    const from = this.table(link.fromTableId);
    const to = this.table(link.toTableId);
    const rows = link.fromIds.map((id) => from[this.rowKey].find((r) => r.id === id)).filter(Boolean);
    const fields = [
      { type: 'info', label: 'References', value: `${from.name} → ${to.name}` },
      { type: 'info', label: from.isAssociation ? 'Key fields' : 'Foreign key fields', value: rows.map((r) => r.name).join(', ') }
    ];
    if (!from.isAssociation) {
      fields.push({ key: 'verb', label: 'Verb', type: 'text', kind: 'association', value: this.verbOf(link), suggestions: this.suggestVerbs(from.name, to.name).filter((s) => s !== this.verbOf(link)) });
    }
    fields.push(
      { key: 'role', label: 'Role (optional)', type: 'text', kind: 'role', optional: true, value: link.role },
      { key: 'required', label: 'Required (not null)', type: 'checkbox', value: rows.every((r) => !r.nullable), readonly: from.isAssociation },
      { key: 'unique', label: 'Unique (one-to-one)', type: 'checkbox', value: rows.every((r) => r.unique), readonly: from.isAssociation }
    );
    return { title: 'Foreign key', icon: 'fa-key', fields };
  }

  inspect(target) {
    if (target.type === 'node') {
      const t = this.table(target.id);
      return t ? this.inspectTable(t) : null;
    }
    if (target.type === 'row') {
      const t = this.table(target.nodeId);
      const r = this.row(target.nodeId, target.rowId);
      return t && r ? this.inspectRow(t, r) : null;
    }
    if (target.type === 'edge') {
      const l = this.link(target.id);
      return l ? this.inspectLink(l) : null;
    }
    return null;
  }

  apply(target, key, value) {
    if (target.type === 'node') {
      const table = this.table(target.id);
      if (!table) return ModelAdapter.fail('Table not found.');
      if (key === 'name') return this.renameNode(target.id, value);
      if (key === 'isAssociation') return this.setAssociation(table, value);
    }
    if (target.type === 'row') {
      const table = this.table(target.nodeId);
      const row = this.row(target.nodeId, target.rowId);
      if (!row) return ModelAdapter.fail('Field not found.');
      if (key === 'name') return this.renameRow(target.nodeId, target.rowId, value);
      if (key === 'pk') return this.setPrimary(table, row, value);
      if (key === 'nullable' || key === 'unique') {
        row[key] = !!value;
        this.afterSync(table);
        return ModelAdapter.ok();
      }
      return this.applyRow(table, row, key, value);
    }
    if (target.type === 'edge') {
      const link = this.link(target.id);
      if (!link) return ModelAdapter.fail('Link not found.');
      const from = this.table(link.fromTableId);
      const rows = link.fromIds.map((id) => from[this.rowKey].find((r) => r.id === id)).filter(Boolean);
      if (key === 'verb') {
        const check = this.checkName('association', value);
        if (!check.ok) return check;
        this.setVerb(link, check.name);
        this.syncKeys();
        return check;
      }
      if (key === 'role') {
        if (String(value || '').trim()) {
          const check = this.checkName('role', value);
          if (!check.ok) return check;
          link.role = check.name;
        } else link.role = '';
        this.syncKeys();
        return ModelAdapter.ok();
      }
      if (key === 'required') { rows.forEach((r) => { r.nullable = !value; }); return ModelAdapter.ok(); }
      if (key === 'unique') { rows.forEach((r) => { r.unique = !!value; }); this.afterSync(from); return ModelAdapter.ok(); }
      return this.applyLink(link, key, value);
    }
    return ModelAdapter.fail('This property cannot be changed.');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  applyRow(table, row, key, value) { return ModelAdapter.fail('This property cannot be changed.'); }
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  applyLink(link, key, value) { return ModelAdapter.fail('This property cannot be changed.'); }
}

/** Logical model. */
export class LdmAdapter extends TableAdapter {
  constructor(store) {
    super(store, 'ldm', { rowKey: 'fields', edgeKey: 'links', rowKind: 'field' });
  }

  get label() { return 'Logical data model'; }
}

/** Physical model: data types, auto increment, fkc_ constraints and idx_ indexes. */
export class PdmAdapter extends TableAdapter {
  constructor(store) {
    super(store, 'pdm', { rowKey: 'columns', edgeKey: 'constraints', rowKind: 'column' });
  }

  get label() { return 'Physical data model'; }
  get layoutKey() { return 'pdm'; }

  verbOf(link) { return link.verb; }
  setVerb(link, verb) { link.verb = verb; }

  makeRow(props) {
    return { id: this.uid('col'), name: '', pk: false, fk: false, nullable: true, unique: false, type: 'VARCHAR(100)', autoIncrement: false, ...props };
  }

  makeLink(props, verb) {
    return { ...props, name: '', verb, onDelete: 'RESTRICT', onUpdate: 'CASCADE' };
  }

  surrogateProps() { return { type: 'INT', autoIncrement: true }; }
  extraTableProps() { return { indexes: [] }; }
  importedRowProps(row) { return { type: row.type || 'VARCHAR(100)' }; }

  rowDetail(row) {
    const parts = [row.type];
    if (!row.nullable && !row.pk) parts.push('NN');
    if (row.autoIncrement) parts.push('AI');
    return parts.join(' ');
  }

  edgeTitle(link) { return link.name; }

  /** Keeps constraint names and unique indexes in line with the convention after every edit. */
  syncKeys() {
    super.syncKeys();
    const names = [];
    this.links.forEach((c) => {
      const from = this.table(c.fromTableId);
      const to = this.table(c.toTableId);
      if (!from || !to) return;
      if (!c.onDelete) c.onDelete = from.isAssociation ? 'CASCADE' : 'RESTRICT';
      if (!c.onUpdate) c.onUpdate = 'CASCADE';
      c.name = this.nc.unique(this.nc.constraintName(from.name, from.isAssociation ? '' : c.verb, to.name, c.role), names);
      names.push(c.name);
    });
  }

  afterSync(table) {
    const previous = new Map((table.indexes || []).map((i) => [i.columnIds.join(','), i]));
    table.indexes = table.columns.filter((c) => c.unique && !c.pk).map((c) => {
      const prev = previous.get(c.id);
      return { id: prev ? prev.id : this.uid('idx'), name: this.nc.indexName('unique', c.name), type: 'unique', columnIds: [c.id] };
    });
    table.columns.forEach((c) => { if (!c.pk) c.autoIncrement = false; });
  }

  inspectTable(table) {
    const base = super.inspectTable(table);
    base.fields.push({
      type: 'info', label: 'Indexes',
      value: (table.indexes || []).map((i) => i.name).join(', ') || 'None. Mark a column as unique to add idx_unique_<column>.'
    });
    return base;
  }

  inspectRow(table, row) {
    const base = super.inspectRow(table, row);
    base.fields.splice(1, 0,
      { key: 'type', label: 'Data type', type: 'combo', value: row.type, options: SQL_TYPES, readonly: row.fk, hint: row.fk ? 'Foreign keys take the type of the column they reference.' : '' },
      { key: 'autoIncrement', label: 'Auto increment', type: 'checkbox', value: row.autoIncrement, readonly: !row.pk || row.fk });
    return base;
  }

  applyRow(table, row, key, value) {
    if (key === 'type') {
      const type = String(value || '').trim().toUpperCase();
      if (!/^[A-Z]+(\s?\(\s*\d+(\s*,\s*\d+)?\s*\))?$/.test(type)) return ModelAdapter.fail(`"${value}" is not a valid SQL type, e.g. VARCHAR(100).`);
      row.type = type.replace(/\s+/g, '');
      this.syncKeys();
      return ModelAdapter.ok();
    }
    if (key === 'autoIncrement') { row.autoIncrement = !!value && row.pk; return ModelAdapter.ok(); }
    return super.applyRow(table, row, key, value);
  }

  inspectLink(link) {
    const base = super.inspectLink(link);
    base.title = 'Foreign key constraint';
    base.fields.unshift({ type: 'info', label: 'Constraint', value: link.name });
    const actions = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'];
    base.fields.push(
      { key: 'onDelete', label: 'On delete', type: 'select', value: link.onDelete, options: actions },
      { key: 'onUpdate', label: 'On update', type: 'select', value: link.onUpdate, options: actions }
    );
    return base;
  }

  applyLink(link, key, value) {
    if (key === 'onDelete' || key === 'onUpdate') { link[key] = value; return ModelAdapter.ok(); }
    return super.applyLink(link, key, value);
  }
}
