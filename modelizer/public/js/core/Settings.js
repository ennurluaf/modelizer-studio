import { EventBus } from './EventBus.js';

const STORAGE_KEY = 'modelizer.settings.v1';

/** User preferences, persisted in the browser. */
export class Settings extends EventBus {
  static get DEFAULTS() {
    return {
      theme: 'dark',
      confirmDelete: true,
      confirmOverwrite: true,
      liveSync: false,
      snapToGrid: true,
      gridSize: 20,
      uiZoom: 1,
      showRowTypes: true,
      keybindings: {}
    };
  }

  constructor() {
    super();
    this.values = { ...Settings.DEFAULTS, ...this.load() };
  }

  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* storage unavailable: settings last for this session only */
    }
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.persist();
    this.emit('change', { key, value });
  }

  reset() {
    this.values = { ...Settings.DEFAULTS };
    this.persist();
    this.emit('change', { key: '*' });
  }
}
