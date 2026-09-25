/** Creates ids and empty documents on the client (same shape as the backend ModelDocument). */
export class DocumentFactory {
  static uid(prefix = 'id') {
    const random = (crypto.randomUUID ? crypto.randomUUID() : `${Math.random()}${Date.now()}`)
      .replace(/[^a-z0-9]/gi, '').slice(0, 10);
    return `${prefix}_${random}`;
  }

  static empty(name = 'Untitled model') {
    const now = new Date().toISOString();
    return {
      format: 'modelizer-document',
      version: 1,
      meta: { name, language: 'en', createdAt: now, updatedAt: now },
      layout: { shared: {}, pdm: {} },
      cdm: { classes: [], associations: [] },
      ldm: { tables: [], links: [] },
      pdm: { tables: [], constraints: [] }
    };
  }

  static isEmpty(doc) {
    return !doc.cdm.classes.length && !doc.ldm.tables.length && !doc.pdm.tables.length;
  }

  static clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
}
