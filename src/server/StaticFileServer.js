'use strict';

const fs = require('fs/promises');
const path = require('path');

/** Serves files from mounted directories, e.g. '/' -> public, '/shared' -> shared. */
class StaticFileServer {
  static get MIME() {
    return {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2'
    };
  }

  constructor() {
    this.mounts = [];
  }

  mount(prefix, directory) {
    this.mounts.push({ prefix: prefix.replace(/\/$/, ''), directory: path.resolve(directory) });
    this.mounts.sort((a, b) => b.prefix.length - a.prefix.length);
    return this;
  }

  resolve(pathname) {
    for (const { prefix, directory } of this.mounts) {
      if (prefix && pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
      let relative = decodeURIComponent(pathname.slice(prefix.length)) || '/';
      if (relative.endsWith('/')) relative += 'index.html';
      const file = path.resolve(directory, `.${relative}`);
      if (file === directory || file.startsWith(directory + path.sep)) return file;
      return null;
    }
    return null;
  }

  async serve(pathname, res) {
    const file = this.resolve(pathname);
    if (!file) return false;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return false;
      const body = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': StaticFileServer.MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(body);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = StaticFileServer;
