import { esc } from './Modal.js';
import { Selection } from '../core/Store.js';

/**
 * Properties panel. It renders whatever descriptor the active adapter returns for the
 * selected item (text, checkbox, cardinality, select, combo, info, heading, button, rows)
 * and writes changes back through adapter.apply() inside store.mutate().
 */
export class Inspector {
  constructor(el, { store, getAdapter, previewName, keybindings, onError }) {
    this.el = el;
    this.store = store;
    this.getAdapter = getAdapter;
    this.previewName = previewName;
    this.keybindings = keybindings;
    this.onError = onError;
    this.focusKey = null;
    this.el.addEventListener('focusin', (e) => { this.focusKey = e.target.dataset.key || null; });
    this.el.addEventListener('focusout', () => setTimeout(() => {
      if (!this.el.contains(document.activeElement)) this.focusKey = null;
    }, 0));
  }

  get adapter() { return this.getAdapter(); }
  get nc() { return window.Modelizer.NamingConvention; }

  render() {
    const items = this.store.selection.items();
    if (!items.length) this.renderOverview();
    else if (items.length > 1) this.renderMulti(items);
    else this.renderItem(items[0]);
    if (this.focusKey) {
      const el = this.el.querySelector(`[data-key="${CSS.escape(this.focusKey)}"]`);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }

  shortcut(id) {
    const combo = this.keybindings.bindingOf(id);
    return combo ? `<kbd>${esc(this.keybindings.constructor.display(combo))}</kbd>` : '';
  }

  // ---------- nothing selected ----------

  renderOverview() {
    const a = this.adapter;
    const nodes = a.nodes().filter((n) => n.variant !== 'assocClass');
    const edges = a.edges();
    const rows = nodes.reduce((sum, n) => sum + n.rows.length, 0);
    const edgeNoun = a.key === 'cdm' ? 'associations' : a.key === 'ldm' ? 'foreign keys' : 'constraints';
    this.el.innerHTML = `
      <div class="insp__head"><i class="fa-solid fa-layer-group"></i><div><h2>${esc(a.label)}</h2><p>Nothing selected</p></div></div>
      <dl class="insp__stats">
        <div><dt>${a.key === 'cdm' ? 'Classes' : 'Tables'}</dt><dd>${nodes.length}</dd></div>
        <div><dt>${a.key === 'cdm' ? 'Attributes' : a.key === 'ldm' ? 'Fields' : 'Columns'}</dt><dd>${rows}</dd></div>
        <div><dt>${edgeNoun[0].toUpperCase()}${edgeNoun.slice(1)}</dt><dd>${edges.length}</dd></div>
      </dl>
      <section class="insp__section">
        <h3>Quick guide</h3>
        <ul class="insp__tips">
          <li><i class="fa-solid fa-computer-mouse"></i><span>Double-click the canvas to add a ${esc(a.nodeNoun)}, a name to rename it.</span></li>
          <li><i class="fa-solid fa-object-group"></i><span>Drag on empty space to select an area. ${this.shortcut('selectAll')} selects everything; Ctrl-click adds to the selection.</span></li>
          <li><i class="fa-solid fa-grip-vertical"></i><span>Drag ${esc(a.rowNoun)}s into another ${esc(a.nodeNoun)} to move them. Hold Alt to copy.</span></li>
          <li><i class="fa-solid fa-link"></i><span>${this.shortcut('linkTool')} starts the link tool; verb names are suggested for you.</span></li>
          <li><i class="fa-solid fa-hand"></i><span>Scroll or Space-drag to pan, Ctrl + scroll to zoom.</span></li>
        </ul>
      </section>
      <section class="insp__section">
        <h3>Naming convention</h3>
        <p class="insp__note">${esc(this.conventionNote(a.key))}</p>
      </section>`;
  }

  conventionNote(model) {
    if (model === 'cdm') return 'Classes: singular UpperCamelCase nouns. Attributes: singular lowerCamelCase nouns. Associations: unique 3rd-person verbs in lowerCamelCase (e.g. lives, isLocated). No keys in the CDM.';
    if (model === 'ldm') return 'Names are transposed from the CDM. Keys: pk_, fk_<referredTable>_<verb>[_<role>], pkfk_ for association tables. Arrows point from the foreign key to the primary key.';
    return 'Tables and columns follow the LDM. Constraints: fkc_Source_verb_Target. Indexes: idx_<type>_<column>. Views, procedures, functions and triggers use vw_, sp_, fn_ and tr_.';
  }

  // ---------- multi-selection ----------

  renderMulti(items) {
    const count = (type) => items.filter((i) => i.type === type).length;
    const a = this.adapter;
    const parts = [];
    const n = count('node');
    const r = count('row');
    const e = count('edge');
    if (n) parts.push(`${n} ${a.nodeNoun === 'class' ? (n > 1 ? 'classes' : 'class') : (n > 1 ? 'tables' : 'table')}`);
    if (r) parts.push(`${r} ${a.rowNoun}${r > 1 ? 's' : ''}`);
    if (e) parts.push(`${e} link${e > 1 ? 's' : ''}`);
    this.el.innerHTML = `
      <div class="insp__head"><i class="fa-solid fa-object-group"></i><div><h2>${items.length} items selected</h2><p>${esc(parts.join(', '))}</p></div></div>
      <div class="insp__actions">
        <button type="button" class="btn" data-command="copy"><i class="fa-regular fa-copy"></i> Copy ${this.shortcut('copy')}</button>
        <button type="button" class="btn" data-command="duplicate"><i class="fa-regular fa-clone"></i> Duplicate ${this.shortcut('duplicate')}</button>
        <button type="button" class="btn btn--danger" data-command="delete"><i class="fa-regular fa-trash-can"></i> Delete ${this.shortcut('delete')}</button>
      </div>
      <p class="insp__note">${r ? `Drag the selected ${esc(a.rowNoun)}s onto another ${esc(a.nodeNoun)} to move them (Alt copies). ` : ''}${n ? 'Drag any selected table to move the group; arrow keys nudge it.' : ''}</p>`;
  }

  // ---------- one item ----------

  renderItem(item) {
    const desc = this.adapter.inspect(item);
    if (!desc) { this.renderOverview(); return; }
    this.target = item;
    this.el.innerHTML = `
      <div class="insp__head"><i class="fa-solid ${esc(desc.icon)}"></i><div><h2>${esc(desc.title)}</h2><p>${esc(this.adapter.label)}</p></div></div>
      <div class="insp__fields">${desc.fields.map((f) => this.fieldHtml(f)).join('')}</div>
      <div class="insp__actions">
        <button type="button" class="btn btn--danger" data-command="delete"><i class="fa-regular fa-trash-can"></i> Delete ${this.shortcut('delete')}</button>
      </div>`;
    desc.fields.forEach((f) => this.wire(f));
  }

  fieldHtml(f) {
    const id = `insp-${f.key || Math.random().toString(36).slice(2)}`;
    const ro = f.readonly ? ' disabled' : '';
    const hint = f.hint ? `<p class="field__hint">${esc(f.hint)}</p>` : '';
    switch (f.type) {
      case 'heading':
        return `<h3 class="field__heading">${esc(f.label)}</h3>`;
      case 'info':
        return `<div class="field field--info"><span class="field__label">${esc(f.label)}</span><code class="field__value">${esc(f.value)}</code></div>`;
      case 'text':
        return `<div class="field" data-field="${esc(f.key)}">
            <label class="field__label" for="${id}">${esc(f.label)}</label>
            <input id="${id}" class="input input--mono" type="text" spellcheck="false" autocomplete="off" data-key="${esc(f.key)}" value="${esc(f.value)}"${ro}>
            <p class="field__preview" aria-live="polite"></p>${hint}
            ${f.suggestions && f.suggestions.length && !f.readonly ? `<div class="chips" aria-label="Suggested names"><span class="chips__label"><i class="fa-solid fa-lightbulb"></i> Suggestions</span>${f.suggestions.map((s) => `<button type="button" class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
          </div>`;
      case 'checkbox':
        return `<label class="check field"${f.readonly ? ' aria-disabled="true"' : ''}><input type="checkbox" data-key="${esc(f.key)}"${f.value ? ' checked' : ''}${ro}> <span>${esc(f.label)}</span></label>`;
      case 'cardinality':
        return `<div class="field"><span class="field__label">${esc(f.label)}</span>
            <div class="seg seg--wide" role="radiogroup">${f.options.map((o) => `<button type="button" role="radio" aria-checked="${o === f.value}" class="${o === f.value ? 'is-active' : ''}" data-key="${esc(f.key)}" data-value="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`;
      case 'select':
        return `<div class="field"><label class="field__label" for="${id}">${esc(f.label)}</label>
            <select id="${id}" class="input" data-key="${esc(f.key)}"${ro}>${f.options.map((o) => `<option${o === f.value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
      case 'combo':
        return `<div class="field"><label class="field__label" for="${id}">${esc(f.label)}</label>
            <input id="${id}" class="input input--mono" list="${id}-list" data-key="${esc(f.key)}" value="${esc(f.value)}"${ro}>
            <datalist id="${id}-list">${f.options.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>${hint}</div>`;
      case 'button':
        return `<button type="button" class="btn btn--block" data-key="${esc(f.key)}"><i class="fa-solid ${esc(f.icon || 'fa-bolt')}"></i> ${esc(f.label)}</button>`;
      case 'rows':
        return `<div class="field"><span class="field__label">${esc(f.label)} <span class="count">${f.rows.length}</span></span>
            <ul class="rowlist">${f.rows.map((r) => `<li><button type="button" class="rowlist__item" data-row="${esc(r.id)}">
              <span class="rowlist__keys">${r.badges.map((b) => (b === 'id' ? '<i class="fa-solid fa-key key--id"></i>' : `<b class="key key--${b}">${b.toUpperCase()}</b>`)).join('')}</span>
              <span class="rowlist__name">${esc(r.name)}</span><span class="rowlist__detail">${esc(r.detail || '')}</span></button></li>`).join('')}</ul>
            <button type="button" class="btn btn--ghost btn--block" data-command="addRow"><i class="fa-solid fa-plus"></i> ${esc(f.addLabel)} ${this.shortcut('addRow')}</button></div>`;
      default:
        return '';
    }
  }

  commit(key, value) {
    const target = this.target;
    this.focusKey = null;
    const result = this.store.mutate('Edit property', () => this.adapter.apply(target, key, value));
    if (!result.ok) {
      this.onError(result.error);
      const field = this.el.querySelector(`[data-field="${CSS.escape(key)}"] .field__preview`);
      if (field) {
        field.className = 'field__preview is-error';
        field.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${esc(result.error)}`;
      }
    }
    return result;
  }

  preview(f, raw) {
    if (f.key === 'name' && (this.target.type === 'node' || this.target.type === 'row')) return this.previewName(this.target, raw);
    if (f.optional && !raw.trim()) return { name: '', issues: [] };
    const name = this.nc.normalize(f.kind, raw);
    return { name, issues: this.nc.validate(f.kind, name, f.context || {}) };
  }

  wire(f) {
    if (f.type === 'text') {
      const input = this.el.querySelector(`input[data-key="${CSS.escape(f.key)}"]`);
      const out = input.parentElement.querySelector('.field__preview');
      const update = () => {
        const { name, issues } = this.preview(f, input.value);
        const err = issues.find((i) => i.level === 'error');
        const warn = issues.find((i) => i.level === 'warning');
        out.className = `field__preview${err ? ' is-error' : warn ? ' is-warning' : ''}`;
        if (err) out.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${esc(err.message)}`;
        else if (warn) out.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${esc(warn.message)}`;
        else if (name && name !== input.value.trim()) out.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Will be saved as <code>${esc(name)}</code>`;
        else out.innerHTML = '';
      };
      input.addEventListener('input', update);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); input.value = f.value || ''; update(); input.blur(); }
      });
      input.addEventListener('change', () => {
        if (input.value.trim() === String(f.value || '')) return;
        if (!this.commit(f.key, input.value).ok) input.focus();
      });
      update();
      input.parentElement.querySelectorAll('[data-suggest]').forEach((chip) => chip.addEventListener('click', () => {
        input.value = chip.dataset.suggest;
        this.commit(f.key, chip.dataset.suggest);
      }));
    } else if (f.type === 'checkbox') {
      const input = this.el.querySelector(`input[data-key="${CSS.escape(f.key)}"]`);
      input.addEventListener('change', () => { if (!this.commit(f.key, input.checked).ok) input.checked = !input.checked; });
    } else if (f.type === 'cardinality') {
      this.el.querySelectorAll(`button[data-key="${CSS.escape(f.key)}"]`).forEach((b) => b.addEventListener('click', () => this.commit(f.key, b.dataset.value)));
    } else if (f.type === 'select' || f.type === 'combo') {
      const input = this.el.querySelector(`[data-key="${CSS.escape(f.key)}"]`);
      input.addEventListener('change', () => { if (!this.commit(f.key, input.value).ok) input.value = f.value; });
      if (f.type === 'combo') input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    } else if (f.type === 'button') {
      this.el.querySelector(`button[data-key="${CSS.escape(f.key)}"]`).addEventListener('click', () => this.commit(f.key, true));
    } else if (f.type === 'rows') {
      const nodeId = this.target.type === 'node' ? this.target.id : this.target.nodeId;
      this.el.querySelectorAll('.rowlist__item').forEach((b) => b.addEventListener('click', () => {
        this.store.selection.set([Selection.row(nodeId, b.dataset.row)]);
      }));
    }
  }

  /** Puts the cursor in a field (e.g. after double-clicking an edge). */
  focus(key) {
    const el = this.el.querySelector(`[data-key="${CSS.escape(key)}"]`) || this.el.querySelector('[data-key="verb"]');
    if (el) { el.focus(); if (el.select) el.select(); }
  }
}
