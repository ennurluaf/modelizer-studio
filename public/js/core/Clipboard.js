/** In-app clipboard for tables and fields (works across CDM, LDM and PDM for fields). */
export class Clipboard {
  constructor() {
    this.entry = null;
  }

  put(model, kind, data) {
    this.entry = { model, kind, data: JSON.parse(JSON.stringify(data)), pasteCount: 0 };
    try {
      navigator.clipboard?.writeText(JSON.stringify({ modelizerClipboard: this.entry })).catch(() => {});
    } catch {
      /* the system clipboard is optional */
    }
  }

  get kind() { return this.entry ? this.entry.kind : null; }
  get isEmpty() { return !this.entry; }

  take() {
    if (!this.entry) return null;
    this.entry.pasteCount += 1;
    return { ...this.entry, data: JSON.parse(JSON.stringify(this.entry.data)) };
  }
}
