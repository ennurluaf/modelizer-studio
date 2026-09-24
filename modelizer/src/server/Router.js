'use strict';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Thin wrapper around IncomingMessage with lazy JSON body parsing. */
class Request {
  constructor(raw, params = {}, maxBytes = 5 * 1024 * 1024) {
    this.raw = raw;
    this.method = raw.method;
    this.url = new URL(raw.url, 'http://localhost');
    this.params = params;
    this.maxBytes = maxBytes;
  }

  async json() {
    if (this.cachedBody !== undefined) return this.cachedBody;
    const chunks = [];
    let size = 0;
    for await (const chunk of this.raw) {
      size += chunk.length;
      if (size > this.maxBytes) throw new HttpError(413, 'Request body is too large.');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    try {
      this.cachedBody = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpError(400, 'Request body must be valid JSON.');
    }
    return this.cachedBody;
  }
}

class Response {
  constructor(raw) {
    this.raw = raw;
  }

  send(status, body, type = 'application/json; charset=utf-8') {
    const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    this.raw.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    this.raw.end(payload);
  }

  json(body, status = 200) { this.send(status, body); }
  text(body, status = 200) { this.send(status, body, 'text/plain; charset=utf-8'); }
}

/** Minimal router: register('GET', '/api/models/:id', handler). */
class Router {
  constructor() {
    this.routes = [];
  }

  register(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    })}$`);
    this.routes.push({ method, regex, keys, handler });
    return this;
  }

  get(p, h) { return this.register('GET', p, h); }
  post(p, h) { return this.register('POST', p, h); }
  put(p, h) { return this.register('PUT', p, h); }
  delete(p, h) { return this.register('DELETE', p, h); }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = pathname.match(route.regex);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

module.exports = { Router, Request, Response, HttpError };
