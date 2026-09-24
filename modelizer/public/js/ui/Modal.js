export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/** Short notifications in the bottom-right corner. */
export class Toast {
  static container() { return document.getElementById('toasts'); }

  static show(message, { type = 'info', timeout = 3800, action = null } = {}) {
    const icons = { info: 'fa-circle-info', success: 'fa-circle-check', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation' };
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span class="toast__text">${esc(message)}</span>`
      + (action ? `<button type="button" class="toast__action">${esc(action.label)}</button>` : '')
      + '<button type="button" class="toast__close" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>';
    const close = () => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 200); };
    el.querySelector('.toast__close').addEventListener('click', close);
    if (action) el.querySelector('.toast__action').addEventListener('click', () => { action.run(); close(); });
    Toast.container().append(el);
    while (Toast.container().children.length > 4) Toast.container().firstElementChild.remove();
    if (timeout) setTimeout(close, timeout);
    return close;
  }

  static info(m, o) { return Toast.show(m, { ...o, type: 'info' }); }
  static success(m, o) { return Toast.show(m, { ...o, type: 'success' }); }
  static warning(m, o) { return Toast.show(m, { ...o, type: 'warning' }); }
  static error(m, o) { return Toast.show(m, { timeout: 6000, ...o, type: 'error' }); }
}

/**
 * Accessible modal dialog. Subclasses (the dialogs) override body() and onOpen().
 * Modal.open() resolves with the value passed to close().
 */
export class Modal {
  constructor({ title, icon = 'fa-window-maximize', size = 'md', actions = [] } = {}) {
    this.title = title;
    this.icon = icon;
    this.size = size;
    this.actions = actions;
    this.resolve = null;
  }

  // eslint-disable-next-line class-methods-use-this
  body() { return ''; }
  // eslint-disable-next-line class-methods-use-this
  onOpen() {}

  $(selector) { return this.root.querySelector(selector); }
  $$(selector) { return [...this.root.querySelectorAll(selector)]; }

  open() {
    this.previousFocus = document.activeElement;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop';
    this.backdrop.innerHTML = `<div class="modal modal--${this.size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal__head">
          <i class="fa-solid ${this.icon} modal__icon" aria-hidden="true"></i>
          <h2 id="modal-title">${esc(this.title)}</h2>
          <button type="button" class="icon-btn modal__close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="modal__body">${this.body()}</div>
        ${this.actions.length ? `<footer class="modal__foot">${this.actions.map((a, i) => `<button type="button" class="btn ${a.primary ? 'btn--primary' : ''} ${a.danger ? 'btn--danger' : ''}" data-action="${i}">${a.icon ? `<i class="fa-solid ${a.icon}"></i> ` : ''}${esc(a.label)}</button>`).join('')}</footer>` : ''}
      </div>`;
    this.root = this.backdrop.querySelector('.modal');
    this.backdrop.addEventListener('pointerdown', (e) => { if (e.target === this.backdrop) this.close(null); });
    this.$('.modal__close').addEventListener('click', () => this.close(null));
    this.$$('[data-action]').forEach((btn) => btn.addEventListener('click', () => {
      const action = this.actions[Number(btn.dataset.action)];
      const value = action.run ? action.run(this) : action.value;
      if (value !== undefined && value !== false) this.close(value);
    }));
    this.backdrop.addEventListener('keydown', (e) => this.onKeyDown(e));
    // If focus drifted out of the dialog (e.g. the canvas grabbed it), keys are pulled back in.
    this.keyHandler = (e) => {
      if (!this.backdrop || this.backdrop.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') this.close(null);
      else this.focusFirst();
    };
    window.addEventListener('keydown', this.keyHandler, true);
    document.body.append(this.backdrop);
    this.onOpen();
    this.focusFirst();
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  focusFirst() {
    const target = this.root.querySelector('[autofocus]') || this.root.querySelector('.modal__foot .btn--primary, .modal__foot .btn--danger') || this.$('.modal__close');
    target.focus();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close(null);
      return;
    }
    if (e.key === 'Tab') {
      const focusable = this.$$('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]').filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
      const primary = this.$('.modal__foot .btn--primary');
      if (primary) { e.preventDefault(); primary.click(); }
    }
    e.stopPropagation();
  }

  close(value) {
    if (!this.backdrop) return;
    window.removeEventListener('keydown', this.keyHandler, true);
    this.backdrop.remove();
    this.backdrop = null;
    if (this.previousFocus && this.previousFocus.focus) this.previousFocus.focus({ preventScroll: true });
    if (this.resolve) this.resolve(value);
  }

  /** Yes/no question; with `dontAsk` a "don't ask again" checkbox is shown. Resolves { ok, dontAsk }. */
  static confirm({ title, message, confirmLabel = 'OK', danger = false, icon = 'fa-circle-question', dontAsk = false }) {
    const modal = new Modal({
      title, icon, size: 'sm',
      actions: [
        { label: 'Cancel', value: { ok: false } },
        { label: confirmLabel, primary: !danger, danger, run: (m) => ({ ok: true, dontAsk: !!m.$('#dont-ask')?.checked }) }
      ]
    });
    modal.body = () => `<p class="modal__message">${esc(message)}</p>`
      + (dontAsk ? '<label class="check"><input type="checkbox" id="dont-ask"> <span>Don\'t ask me again (you can turn it back on in Settings)</span></label>' : '');
    return modal.open().then((v) => v || { ok: false });
  }
}
