/** Talks to the Node backend. Every method throws an Error with a readable message. */
export class Api {
  constructor(base = '/api') {
    this.base = base;
  }

  async request(method, path, body) {
    let response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new Error('The server is not reachable. Start it with "npm start".');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  transform(direction, document) { return this.request('POST', `/transform/${direction}`, { document }); }
  importText(text) { return this.request('POST', '/import', { text }); }
  exportSql(document) { return this.request('POST', '/export/sql', { document }); }
  listModels() { return this.request('GET', '/models'); }
  getModel(id) { return this.request('GET', `/models/${encodeURIComponent(id)}`); }
  createModel(document) { return this.request('POST', '/models', { document }); }
  saveModel(id, document) { return this.request('PUT', `/models/${encodeURIComponent(id)}`, { document }); }
  deleteModel(id) { return this.request('DELETE', `/models/${encodeURIComponent(id)}`); }
}
