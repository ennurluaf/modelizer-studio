import { Modal, Toast, esc } from './Modal.js';
import { CARDINALITIES } from '../adapters/CdmAdapter.js';
import { KeybindingManager } from '../core/KeybindingManager.js';

const nc = () => window.Modelizer.NamingConvention;

function previewHtml(kind, raw, { optional = false } = {}) {
  if (optional && !String(raw).trim()) return '';
  const name = nc().normalize(kind, raw);
  const issues = nc().validate(kind, name);
  const err = issues.find((i) => i.level === 'error');
  const warn = issues.find((i) => i.level === 'warning');
  if (err) return `<span class="is-error"><i class="fa-solid fa-circle-exclamation"></i> ${esc(err.message)}</span>`;
  if (warn) return `<span class="is-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(warn.message)}</span>`;
  if (name !== String(raw).trim()) return `<span><i class="fa-solid fa-wand-magic-sparkles"></i> Saved as <code>${esc(name)}</code></span>`;
  return '';
}

// ======================================================================
// Link dialog: new association (CDM) or foreign key (LDM / PDM)
// ======================================================================

export class LinkDialog extends Modal {
  /** `submit(values)` must return { ok } or { ok:false, error }. */
  constructor(spec, adapter, submit) {
    super({
      title: spec.type === 'association' ? 'New association' : adapter.key === 'pdm' ? 'New foreign key constraint' : 'New foreign key',
      icon: spec.type === 'association' ? 'fa-arrows-left-right' : 'fa-key',
      size: 'md',
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Create link', primary: true, icon: 'fa-link', run: (m) => m.submitForm() }
      ]
    });
    this.spec = spec;
    this.adapter = adapter;
    this.submit = submit;
    this.reflexive = spec.from.id === spec.to.id;
  }

  body() {
    const { spec } = this;
    const chips = spec.suggestions.map((s) => `<button type="button" class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('');
    const needsVerb = spec.type === 'association' || !spec.from.isAssociation;
    const verbField = needsVerb ? `
      <div class="field">
        <label class="field__label" for="link-verb">Verb <span class="muted">(3rd person, lowerCamelCase)</span></label>
        <input id="link-verb" class="input input--mono" type="text" autocomplete="off" spellcheck="false" value="${esc(spec.suggestions[0] || '')}" autofocus>
        <p class="field__preview" id="verb-preview"></p>
        ${chips ? `<div class="chips"><span class="chips__label"><i class="fa-solid fa-lightbulb"></i> Suggested for ${esc(spec.from.name)} → ${esc(spec.to.name)}</span>${chips}</div>` : ''}
      </div>` : '<p class="insp__note">Association tables reference their tables with pkfk_ keys and no verb.</p>';
    const header = `<div class="link-ends"><span class="link-end">${esc(spec.from.name)}</span><i class="fa-solid ${spec.type === 'association' ? 'fa-minus' : 'fa-arrow-right-long'}"></i><span class="link-end">${esc(spec.to.name)}</span></div>`;

    if (spec.type === 'association') {
      const seg = (name, value) => `<div class="seg seg--wide" data-seg="${name}">${CARDINALITIES.map((c) => `<button type="button" class="${c === value ? 'is-active' : ''}" data-value="${c}">${c}</button>`).join('')}</div>`;
      return `${header}${verbField}
        <div class="grid-2">
          <div class="field"><span class="field__label">${esc(spec.from.name)} per ${esc(spec.to.name)}</span>${seg('fromCard', '0..n')}
            <label class="field__label" for="from-role">Role <span class="muted">${this.reflexive ? '(needed for reflexive links)' : '(optional)'}</span></label>
            <input id="from-role" class="input input--mono" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. participant"><p class="field__preview" id="from-role-preview"></p></div>
          <div class="field"><span class="field__label">${esc(spec.to.name)} per ${esc(spec.from.name)}</span>${seg('toCard', '1')}
            <label class="field__label" for="to-role">Role <span class="muted">${this.reflexive ? '(needed for reflexive links)' : '(optional)'}</span></label>
            <input id="to-role" class="input input--mono" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. trainer"><p class="field__preview" id="to-role-preview"></p></div>
        </div>
        <label class="check"><input type="checkbox" id="with-class"> <span>Add an association class (named like the verb, joined with a dotted line)</span></label>
        <p class="field__hint" id="card-hint"></p>
        <p class="form-error" id="link-error" hidden></p>`;
    }
    return `${header}${verbField}
      <div class="field"><label class="field__label" for="fk-role">Role <span class="muted">(optional, added at the end)</span></label>
        <input id="fk-role" class="input input--mono" type="text" autocomplete="off" spellcheck="false"><p class="field__preview" id="fk-role-preview"></p></div>
      <div class="grid-2">
        <label class="check"><input type="checkbox" id="fk-required" ${spec.from.isAssociation ? 'checked disabled' : ''}> <span>Required (NOT NULL)</span></label>
        <label class="check"><input type="checkbox" id="fk-unique" ${spec.from.isAssociation ? 'disabled' : ''}> <span>Unique (one-to-one)</span></label>
      </div>
      <div class="name-preview"><span class="field__label">Generated names</span><code id="fk-names"></code></div>
      <p class="form-error" id="link-error" hidden></p>`;
  }

  onOpen() {
    const verb = this.$('#link-verb');
    const refresh = () => this.refresh();
    this.$$('input').forEach((i) => i.addEventListener('input', refresh));
    this.$$('input[type="checkbox"]').forEach((i) => i.addEventListener('change', refresh));
    this.$$('[data-suggest]').forEach((chip) => chip.addEventListener('click', () => {
      verb.value = chip.dataset.suggest;
      verb.focus();
      refresh();
    }));
    this.$$('[data-seg]').forEach((seg) => seg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-value]');
      if (!btn) return;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === btn));
      refresh();
    }));
    refresh();
  }

  segValue(name) { return this.$(`[data-seg="${name}"] .is-active`)?.dataset.value; }

  values() {
    const v = (id) => (this.$(id) ? this.$(id).value : '');
    if (this.spec.type === 'association') {
      return {
        name: v('#link-verb'), fromCard: this.segValue('fromCard'), toCard: this.segValue('toCard'),
        fromRole: v('#from-role'), toRole: v('#to-role'), withClass: this.$('#with-class').checked
      };
    }
    return { verb: v('#link-verb'), role: v('#fk-role'), required: this.$('#fk-required').checked, unique: this.$('#fk-unique').checked };
  }

  refresh() {
    const vals = this.values();
    if (this.$('#verb-preview')) this.$('#verb-preview').innerHTML = previewHtml('association', this.$('#link-verb').value);
    if (this.spec.type === 'association') {
      this.$('#from-role-preview').innerHTML = previewHtml('role', vals.fromRole, { optional: true });
      this.$('#to-role-preview').innerHTML = previewHtml('role', vals.toRole, { optional: true });
      const max = (c) => (c.endsWith('1') ? 1 : Infinity);
      const { from, to } = this.spec;
      let hint;
      if (max(vals.fromCard) === Infinity && max(vals.toCard) === Infinity) hint = `Many-to-many: the LDM gets an association table "${nc().normalize('association', vals.name) || 'verb'}".`;
      else if (vals.withClass) hint = 'With an association class, the LDM gets an association table named after the verb.';
      else if (max(vals.toCard) === 1) hint = `${from.name} will receive the foreign key to ${to.name}.`;
      else hint = `${to.name} will receive the foreign key to ${from.name}.`;
      this.$('#card-hint').innerHTML = `<i class="fa-solid fa-diagram-next"></i> ${esc(hint)}`;
      return;
    }
    this.$('#fk-role-preview').innerHTML = previewHtml('role', vals.role, { optional: true });
    const { from, to } = this.spec;
    const verb = nc().normalize('association', vals.verb);
    const role = vals.role.trim() ? nc().normalize('role', vals.role) : '';
    const field = from.isAssociation ? nc().pkfkName(to.name, role) : nc().fkName(to.name, verb || 'verb', role);
    let text = field;
    if (this.adapter.key === 'pdm') text += `   ·   ${nc().constraintName(from.name, from.isAssociation ? '' : verb || 'verb', to.name, role)}`;
    this.$('#fk-names').textContent = text;
  }

  submitForm() {
    const result = this.submit(this.values());
    if (result.ok) return true;
    const err = this.$('#link-error');
    err.hidden = false;
    err.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${esc(result.error)}`;
    return false;
  }
}

// ======================================================================
// Settings
// ======================================================================

export class SettingsDialog extends Modal {
  constructor(settings, keybindings) {
    super({ title: 'Settings', icon: 'fa-sliders', size: 'lg', actions: [{ label: 'Done', primary: true, value: true }] });
    this.settings = settings;
    this.keybindings = keybindings;
    this.tab = 'general';
  }

  body() {
    return `<div class="tabs" role="tablist">
        <button type="button" role="tab" class="tabs__tab is-active" data-tab="general"><i class="fa-solid fa-gear"></i> General</button>
        <button type="button" role="tab" class="tabs__tab" data-tab="keys"><i class="fa-regular fa-keyboard"></i> Keyboard shortcuts</button>
      </div>
      <div class="tabs__panel" data-panel="general">${this.generalHtml()}</div>
      <div class="tabs__panel" data-panel="keys" hidden></div>`;
  }

  toggle(key, label, help) {
    return `<label class="switch"><input type="checkbox" data-setting="${key}"${this.settings.get(key) ? ' checked' : ''}>
      <span class="switch__track" aria-hidden="true"></span><span class="switch__text"><strong>${esc(label)}</strong><small>${esc(help)}</small></span></label>`;
  }

  generalHtml() {
    const s = this.settings;
    return `<section class="settings-group"><h3>Editing</h3>
        ${this.toggle('confirmDelete', 'Ask before deleting', 'Show a confirmation alert when you delete tables, fields or links.')}
        ${this.toggle('confirmOverwrite', 'Ask before overwriting a model', 'Confirm before a transformation or import replaces an existing model.')}
        ${this.toggle('liveSync', 'Keep LDM and PDM in sync', 'Regenerate the LDM and PDM automatically after every CDM edit.')}
        ${this.toggle('snapToGrid', 'Snap to grid', 'Align tables to the grid while dragging (hold Alt to move freely).')}
        ${this.toggle('showRowTypes', 'Show data types in the PDM', 'Display types and NN / AI flags next to column names.')}
      </section>
      <section class="settings-group"><h3>Appearance</h3>
        <div class="setting-row"><span>Theme</span><div class="seg" data-seg-setting="theme">
          ${[['dark', 'fa-moon', 'Dark'], ['light', 'fa-sun', 'Light']].map(([v, i, l]) => `<button type="button" data-value="${v}" class="${s.get('theme') === v ? 'is-active' : ''}"><i class="fa-solid ${i}"></i> ${l}</button>`).join('')}
        </div></div>
        <div class="setting-row"><span>Grid size</span><div class="seg" data-seg-setting="gridSize">
          ${[10, 20, 40].map((v) => `<button type="button" data-value="${v}" class="${s.get('gridSize') === v ? 'is-active' : ''}">${v}px</button>`).join('')}
        </div></div>
        <div class="setting-row"><label for="ui-zoom-setting">Interface size (menus and panels)</label>
          <div class="range-with-value"><input type="range" id="ui-zoom-setting" min="0.75" max="1.5" step="0.05" value="${s.get('uiZoom')}"><output id="ui-zoom-out">${Math.round(s.get('uiZoom') * 100)}%</output></div></div>
        <p class="field__hint">The diagram has its own zoom in the status bar, so text in the menus and tables can be sized separately.</p>
      </section>
      <section class="settings-group"><h3>Reset</h3>
        <button type="button" class="btn btn--ghost" id="reset-settings"><i class="fa-solid fa-arrow-rotate-left"></i> Restore default settings</button>
      </section>`;
  }

  keysHtml() {
    const kb = this.keybindings;
    return `<div class="keys-toolbar"><input type="search" class="input" id="key-filter" placeholder="Filter commands…" aria-label="Filter commands">
        <button type="button" class="btn btn--ghost" id="reset-keys"><i class="fa-solid fa-arrow-rotate-left"></i> Reset all</button></div>
      <p class="field__hint">Click a shortcut, then press the new key combination. Esc cancels, Backspace removes the shortcut.</p>
      ${KeybindingManager.DEFAULTS.map(([group, actions]) => `<section class="keys-group"><h3>${esc(group)}</h3><ul>
        ${actions.map(([id, label]) => {
          const combo = kb.bindingOf(id);
          const changed = combo !== kb.defaults.get(id);
          return `<li class="keys-row" data-label="${esc(label.toLowerCase())}"><span>${esc(label)}${changed ? ' <em class="muted">(custom)</em>' : ''}</span>
            <button type="button" class="kbd-btn${combo ? '' : ' is-empty'}" data-bind="${id}">${combo ? esc(KeybindingManager.display(combo)) : 'Not set'}</button>
            <button type="button" class="icon-btn" data-reset="${id}" aria-label="Reset ${esc(label)}"${changed ? '' : ' disabled'}><i class="fa-solid fa-arrow-rotate-left"></i></button></li>`;
        }).join('')}</ul></section>`).join('')}`;
  }

  onOpen() {
    this.$$('.tabs__tab').forEach((t) => t.addEventListener('click', () => this.showTab(t.dataset.tab)));
    this.wireGeneral();
    this.renderKeys();
  }

  showTab(tab) {
    this.$$('.tabs__tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab));
    this.$$('.tabs__panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  }

  wireGeneral() {
    const panel = this.$('[data-panel="general"]');
    panel.querySelectorAll('[data-setting]').forEach((i) => i.addEventListener('change', () => this.settings.set(i.dataset.setting, i.checked)));
    panel.querySelectorAll('[data-seg-setting]').forEach((seg) => seg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-value]');
      if (!btn) return;
      const key = seg.dataset.segSetting;
      this.settings.set(key, key === 'gridSize' ? Number(btn.dataset.value) : btn.dataset.value);
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === btn));
    }));
    const range = panel.querySelector('#ui-zoom-setting');
    range.addEventListener('input', () => {
      this.settings.set('uiZoom', Number(range.value));
      panel.querySelector('#ui-zoom-out').textContent = `${Math.round(range.value * 100)}%`;
    });
    panel.querySelector('#reset-settings').addEventListener('click', () => {
      const keys = this.settings.get('keybindings');
      this.settings.reset();
      this.settings.set('keybindings', keys);
      panel.innerHTML = this.generalHtml();
      this.wireGeneral();
      Toast.success('Settings restored. Keyboard shortcuts were kept.');
    });
  }

  renderKeys() {
    const panel = this.$('[data-panel="keys"]');
    const filter = panel.querySelector('#key-filter')?.value || '';
    panel.innerHTML = this.keysHtml();
    const input = panel.querySelector('#key-filter');
    input.value = filter;
    const applyFilter = () => panel.querySelectorAll('.keys-row').forEach((row) => {
      row.hidden = !!input.value && !row.dataset.label.includes(input.value.toLowerCase());
    });
    input.addEventListener('input', applyFilter);
    applyFilter();
    panel.querySelector('#reset-keys').addEventListener('click', () => { this.keybindings.resetAll(); this.renderKeys(); });
    panel.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.reset;
      this.keybindings.assign(id, this.keybindings.defaults.get(id));
      this.renderKeys();
    }));
    panel.querySelectorAll('[data-bind]').forEach((b) => b.addEventListener('click', () => {
      panel.querySelectorAll('.kbd-btn.is-recording').forEach((x) => x.classList.remove('is-recording'));
      b.classList.add('is-recording');
      b.textContent = 'Press keys…';
      this.keybindings.record((combo) => {
        const id = b.dataset.bind;
        if (combo === 'Escape') { this.renderKeys(); return; }
        if (combo === 'Backspace') { this.keybindings.assign(id, ''); this.renderKeys(); return; }
        const previous = this.keybindings.assign(id, combo);
        if (previous) Toast.warning(`${KeybindingManager.display(combo)} was used by "${this.keybindings.labels.get(previous)}", which now has no shortcut.`);
        this.renderKeys();
        panel.querySelector(`[data-bind="${id}"]`)?.focus();
      });
    }));
  }

  close(value) {
    this.keybindings.recording = null;
    super.close(value);
  }
}

// ======================================================================
// Import (textarea, file input or drag and drop)
// ======================================================================

export class ImportDialog extends Modal {
  constructor(api) {
    super({
      title: 'Import data models', icon: 'fa-file-import', size: 'lg',
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Import', primary: true, icon: 'fa-file-import', run: (m) => { m.submitForm(); return false; } }
      ]
    });
    this.api = api;
  }

  body() {
    return `<label class="dropzone" id="dropzone">
        <input type="file" id="import-file" accept=".json,application/json" hidden>
        <i class="fa-solid fa-cloud-arrow-up"></i>
        <strong>Drop a .json file here or click to browse</strong>
        <small>One file holds the CDM, LDM and PDM together.</small>
      </label>
      <div class="or"><span>or paste JSON</span></div>
      <textarea id="import-text" class="input input--mono textarea" rows="12" spellcheck="false" placeholder='{ "format": "modelizer-document", "cdm": { … }, "ldm": { … }, "pdm": { … } }'></textarea>
      <p class="field__hint">A document with only a CDM or only a PDM also works: generate the other models with the Transform menu afterwards.</p>
      <p class="form-error" id="import-error" hidden></p>`;
  }

  onOpen() {
    const zone = this.$('#dropzone');
    const file = this.$('#import-file');
    const read = async (f) => {
      if (!f) return;
      this.$('#import-text').value = await f.text();
      zone.classList.add('has-file');
      zone.querySelector('strong').textContent = f.name;
    };
    file.addEventListener('change', () => read(file.files[0]));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      read(e.dataTransfer.files[0]);
    });
  }

  async submitForm() {
    const text = this.$('#import-text').value.trim();
    const error = this.$('#import-error');
    if (!text) {
      error.hidden = false;
      error.textContent = 'Paste JSON or choose a file first.';
      return;
    }
    try {
      const result = await this.api.importText(text);
      this.close(result);
    } catch (err) {
      error.hidden = false;
      error.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${esc(err.message)}`;
    }
  }
}

// ======================================================================
// Models saved on the server
// ======================================================================

export class LibraryDialog extends Modal {
  constructor(api, confirmDelete) {
    super({ title: 'Models on the server', icon: 'fa-server', size: 'md', actions: [{ label: 'Close', value: null }] });
    this.api = api;
    this.confirmDelete = confirmDelete;
  }

  body() { return '<ul class="library" id="library"><li class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</li></ul>'; }

  onOpen() { this.load(); }

  async load() {
    const list = this.$('#library');
    try {
      const { models } = await this.api.listModels();
      if (!models.length) {
        list.innerHTML = '<li class="library__empty"><i class="fa-regular fa-folder-open"></i> No saved models yet. Use File → Save to server.</li>';
        return;
      }
      list.innerHTML = models.map((m) => `<li class="library__item">
          <button type="button" class="library__open" data-open="${esc(m.id)}"><i class="fa-solid fa-diagram-project"></i>
            <span><strong>${esc(m.name)}</strong><small>${m.classes} classes · ${m.tables} tables · ${m.updatedAt ? new Date(m.updatedAt).toLocaleString() : ''}</small></span></button>
          <button type="button" class="icon-btn icon-btn--danger" data-remove="${esc(m.id)}" aria-label="Delete ${esc(m.name)}"><i class="fa-regular fa-trash-can"></i></button></li>`).join('');
      list.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
        try {
          const { id, document } = await this.api.getModel(b.dataset.open);
          this.close({ id, document });
        } catch (err) { Toast.error(err.message); }
      }));
      list.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await this.confirmDelete('this saved model'))) return;
        try {
          await this.api.deleteModel(b.dataset.remove);
          this.load();
        } catch (err) { Toast.error(err.message); }
      }));
    } catch (err) {
      list.innerHTML = `<li class="form-error"><i class="fa-solid fa-circle-exclamation"></i> ${esc(err.message)}</li>`;
    }
  }
}

// ======================================================================
// Print options
// ======================================================================

export class PrintDialog extends Modal {
  constructor(docName, counts) {
    super({
      title: 'Print or save as PDF', icon: 'fa-print', size: 'md',
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Print…', primary: true, icon: 'fa-print', run: (m) => m.values() }
      ]
    });
    this.docName = docName;
    this.counts = counts;
  }

  body() {
    const model = (key, label) => `<label class="print-model${this.counts[key] ? '' : ' is-disabled'}">
        <input type="checkbox" name="models" value="${key}"${this.counts[key] ? ' checked' : ' disabled'}>
        <span class="print-model__code print-model__code--${key}">${key.toUpperCase()}</span>
        <span><strong>${label}</strong><small>${this.counts[key] ? `${this.counts[key]} ${key === 'cdm' ? 'classes' : 'tables'}` : 'empty'}</small></span></label>`;
    return `<div class="field"><span class="field__label">Models (one page each)</span>
        <div class="print-models">${model('cdm', 'Conceptual')}${model('ldm', 'Logical')}${model('pdm', 'Physical')}</div></div>
      <div class="grid-2">
        <div class="field"><span class="field__label">Orientation</span><div class="seg seg--wide" data-seg="orientation">
          <button type="button" class="is-active" data-value="landscape"><i class="fa-solid fa-image"></i> Landscape</button>
          <button type="button" data-value="portrait"><i class="fa-solid fa-file"></i> Portrait</button></div></div>
        <div class="field"><label class="field__label" for="paper">Paper size</label>
          <select id="paper" class="input"><option value="A4">A4</option><option value="A3">A3</option><option value="letter">Letter</option></select></div>
      </div>
      <div class="field"><label class="field__label" for="print-title">Title on each page</label>
        <input id="print-title" class="input" type="text" value="${esc(this.docName)}"></div>
      <label class="check"><input type="checkbox" id="print-legend" checked> <span>Add the model name and date in the header</span></label>
      <p class="field__hint"><i class="fa-solid fa-circle-info"></i> Choose "Save as PDF" as the printer in the browser dialog to get a PDF file.</p>
      <p class="form-error" id="print-error" hidden></p>`;
  }

  onOpen() {
    this.$$('[data-seg]').forEach((seg) => seg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-value]');
      if (btn) seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === btn));
    }));
  }

  values() {
    const models = this.$$('input[name="models"]:checked').map((i) => i.value);
    if (!models.length) {
      const err = this.$('#print-error');
      err.hidden = false;
      err.textContent = 'Choose at least one model.';
      return false;
    }
    return {
      models,
      orientation: this.$('[data-seg="orientation"] .is-active').dataset.value,
      paper: this.$('#paper').value,
      title: this.$('#print-title').value.trim(),
      header: this.$('#print-legend').checked
    };
  }
}
