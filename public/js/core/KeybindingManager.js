/**
 * Maps key combos ("Mod+Shift+Z") to command ids. Defaults can be overridden per user;
 * overrides are stored in Settings.keybindings.
 * "Mod" means Ctrl on Windows/Linux and Cmd on macOS.
 */
export class KeybindingManager {
  static get DEFAULTS() {
    return [
      ['Editing', [
        ['undo', 'Undo', 'Mod+Z'],
        ['redo', 'Redo', 'Mod+Y'],
        ['copy', 'Copy', 'Mod+C'],
        ['cut', 'Cut', 'Mod+X'],
        ['paste', 'Paste', 'Mod+V'],
        ['duplicate', 'Duplicate', 'Mod+D'],
        ['delete', 'Delete selection', 'Delete'],
        ['selectAll', 'Select all', 'Mod+A'],
        ['rename', 'Rename', 'F2'],
        ['escape', 'Cancel / clear selection', 'Escape']
      ]],
      ['Tools', [
        ['addNode', 'Add table or class', 'N'],
        ['addRow', 'Add field to selected table', 'F'],
        ['linkTool', 'Link tool', 'L'],
        ['toolSelect', 'Select tool', 'V'],
        ['nudgeLeft', 'Move selection left', 'ArrowLeft'],
        ['nudgeRight', 'Move selection right', 'ArrowRight'],
        ['nudgeUp', 'Move selection up', 'ArrowUp'],
        ['nudgeDown', 'Move selection down', 'ArrowDown']
      ]],
      ['Models', [
        ['tabCdm', 'Show CDM', 'Alt+1'],
        ['tabLdm', 'Show LDM', 'Alt+2'],
        ['tabPdm', 'Show PDM', 'Alt+3'],
        ['cdmToLdm', 'Generate LDM from CDM', 'Alt+L'],
        ['ldmToPdm', 'Generate PDM from LDM', 'Alt+P'],
        ['pdmToCdm', 'Rebuild CDM from PDM', 'Alt+C'],
        ['toggleIssues', 'Show naming issues', 'Alt+V']
      ]],
      ['File', [
        ['save', 'Save to server', 'Mod+S'],
        ['exportJson', 'Export JSON', 'Mod+Shift+S'],
        ['import', 'Import JSON', 'Mod+O'],
        ['print', 'Print or save as PDF', 'Mod+P'],
        ['settings', 'Settings', 'Mod+,']
      ]],
      ['View', [
        ['zoomIn', 'Zoom diagram in', 'Mod+='],
        ['zoomOut', 'Zoom diagram out', 'Mod+-'],
        ['zoomReset', 'Reset diagram zoom', 'Mod+0'],
        ['fit', 'Fit diagram to screen', 'Shift+F'],
        ['uiZoomIn', 'Enlarge interface', 'Mod+Shift+='],
        ['uiZoomOut', 'Shrink interface', 'Mod+Shift+-'],
        ['uiZoomReset', 'Reset interface size', 'Mod+Shift+0']
      ]]
    ];
  }

  static get isMac() {
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  }

  constructor(settings, commands) {
    this.settings = settings;
    this.commands = commands;
    this.defaults = new Map();
    this.labels = new Map();
    KeybindingManager.DEFAULTS.forEach(([, actions]) => actions.forEach(([id, label, combo]) => {
      this.defaults.set(id, combo);
      this.labels.set(id, label);
    }));
    this.recording = null;
    document.addEventListener('keydown', (e) => this.onKeyDown(e), true);
  }

  static keyName(e) {
    const { code, key } = e;
    if (['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(key)) return null;
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
    const named = {
      Equal: '=', Minus: '-', NumpadAdd: '=', NumpadSubtract: '-', Comma: ',', Period: '.',
      Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
      Backquote: '`', Space: 'Space'
    };
    if (named[code]) return named[code];
    return key.length === 1 ? key.toUpperCase() : key;
  }

  static comboFrom(e) {
    const key = KeybindingManager.keyName(e);
    if (!key) return null;
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Mod');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(key);
    return parts.join('+');
  }

  static display(combo) {
    if (!combo) return '—';
    return combo.split('+').map((p) => {
      if (p === 'Mod') return KeybindingManager.isMac ? '⌘' : 'Ctrl';
      if (p === 'Alt') return KeybindingManager.isMac ? '⌥' : 'Alt';
      if (p === 'Shift') return KeybindingManager.isMac ? '⇧' : 'Shift';
      return p.replace('Arrow', '');
    }).join(KeybindingManager.isMac ? '' : '+');
  }

  bindingOf(id) {
    const overrides = this.settings.get('keybindings') || {};
    return Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : this.defaults.get(id);
  }

  commandFor(combo) {
    return [...this.defaults.keys()].find((id) => this.bindingOf(id) === combo) || null;
  }

  /** Assigns a combo; a command that already used it loses its binding. Returns that command id. */
  assign(id, combo) {
    const overrides = { ...(this.settings.get('keybindings') || {}) };
    const previousOwner = combo ? this.commandFor(combo) : null;
    if (previousOwner && previousOwner !== id) overrides[previousOwner] = '';
    overrides[id] = combo;
    if (combo === this.defaults.get(id)) delete overrides[id];
    this.settings.set('keybindings', overrides);
    return previousOwner !== id ? previousOwner : null;
  }

  resetAll() {
    this.settings.set('keybindings', {});
  }

  /** Calls back with the next combo pressed (used by the settings dialog). */
  record(callback) {
    this.recording = callback;
  }

  static isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  onKeyDown(e) {
    if (this.recording) {
      const combo = KeybindingManager.comboFrom(e);
      if (!combo) return;
      e.preventDefault();
      e.stopPropagation();
      const callback = this.recording;
      this.recording = null;
      callback(combo);
      return;
    }
    const combo = KeybindingManager.comboFrom(e);
    if (!combo) return;
    if (KeybindingManager.isTyping(e.target)) {
      // Inside inputs only Escape and Mod+S/Mod+P keep working.
      if (!['Escape', 'Mod+S', 'Mod+P'].includes(combo)) return;
      if (combo === 'Escape') return;
    }
    if (document.querySelector('.modal-backdrop') && combo !== 'Escape') return;
    const id = this.commandFor(combo);
    if (!id || !this.commands.has(id)) return;
    e.preventDefault();
    this.commands.run(id, { source: 'keyboard', event: e });
  }
}
