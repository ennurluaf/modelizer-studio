'use strict';

const http = require('http');
const path = require('path');
const { Router, Request, Response, HttpError } = require('./Router');
const StaticFileServer = require('./StaticFileServer');
const ModelRepository = require('../repositories/ModelRepository');
const TransformationService = require('../domain/TransformationService');
const SqlDdlGenerator = require('../domain/SqlDdlGenerator');
const { DomainError } = require('../domain/DomainError');
const { ModelController, TransformController, ToolController } = require('../controllers/Controllers');
const ModelValidator = require('../../shared/ModelValidator');
const LinkNameSuggester = require('../../shared/LinkNameSuggester');

class Application {
  constructor({ port = 3000, root = path.resolve(__dirname, '..', '..') } = {}) {
    this.port = port;
    this.root = root;
    this.router = new Router();
    this.static = new StaticFileServer()
      .mount('/', path.join(root, 'public'))
      .mount('/shared', path.join(root, 'shared'));
  }

  async init() {
    const repository = await new ModelRepository(path.join(this.root, 'data')).init();
    [
      new ModelController(repository),
      new TransformController(new TransformationService()),
      new ToolController({
        validator: new ModelValidator(),
        suggester: new LinkNameSuggester(),
        sqlGenerator: new SqlDdlGenerator()
      })
    ].forEach((controller) => controller.register(this.router));
    return this;
  }

  async handle(rawReq, rawRes) {
    const res = new Response(rawRes);
    const url = new URL(rawReq.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const match = this.router.match(rawReq.method, url.pathname);
        if (!match) throw new HttpError(404, `No endpoint ${rawReq.method} ${url.pathname}.`);
        if (match.methodNotAllowed) throw new HttpError(405, `${rawReq.method} is not allowed on ${url.pathname}.`);
        await match.route.handler(new Request(rawReq, match.params), res);
        return;
      }
      if (rawReq.method === 'GET' && await this.static.serve(url.pathname, rawRes)) return;
      throw new HttpError(404, 'Not found.');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof DomainError ? 422 : 500;
      if (status === 500) console.error(err);
      res.json({ error: status === 500 ? 'Unexpected server error.' : err.message, details: err.details || [] }, status);
    }
  }

  listen() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Modelizer Studio running on http://localhost:${this.port}`);
        resolve(this.server);
      });
    });
  }
}

module.exports = Application;
