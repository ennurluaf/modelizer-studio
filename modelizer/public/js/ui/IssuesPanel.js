import { esc } from './Modal.js';

const MODEL_NAMES = { cdm: 'CDM', ldm: 'LDM', pdm: 'PDM' };

/** Lists naming-convention issues; clicking one opens its model and selects the item. */
export class IssuesPanel {
  constructor({ section, list, scope, onPick }) {
    this.section = section;
    this.list = list;
    this.scopeEl = scope;
    this.onPick = onPick;
    this.scope = 'model';
    this.issues = [];
    this.activeModel = 'cdm';
    scope.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-scope]');
      if (!btn) return;
      this.scope = btn.dataset.scope;
      scope.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle('is-active', b === btn));
      this.render();
    });
    list.addEventListener('click', (e) => {
      const item = e.target.closest('[data-index]');
      if (item) this.onPick(this.visible[Number(item.dataset.index)]);
    });
  }

  get open() { return !this.section.hidden; }

  toggle(force) {
    this.section.hidden = force === undefined ? !this.section.hidden : !force;
    this.render();
  }

  update(issues, activeModel) {
    this.issues = issues;
    this.activeModel = activeModel;
    if (this.open) this.render();
  }

  render() {
    this.visible = this.scope === 'all' ? this.issues : this.issues.filter((i) => i.model === this.activeModel);
    this.visible = [...this.visible].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
    if (!this.visible.length) {
      this.list.innerHTML = `<li class="issues__ok"><i class="fa-solid fa-circle-check"></i> ${this.scope === 'all' ? 'All three models follow' : `The ${MODEL_NAMES[this.activeModel]} follows`} the naming convention.</li>`;
      return;
    }
    this.list.innerHTML = this.visible.map((issue, i) => `<li><button type="button" class="issue issue--${issue.level}" data-index="${i}">
        <i class="fa-solid ${issue.level === 'error' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}"></i>
        ${this.scope === 'all' ? `<span class="issue__model issue__model--${issue.model}">${MODEL_NAMES[issue.model]}</span>` : ''}
        <span class="issue__text">${esc(issue.message)}</span></button></li>`).join('');
  }
}
