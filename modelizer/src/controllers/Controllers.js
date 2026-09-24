'use strict';

const { HttpError } = require('../server/Router');
const ModelDocument = require('../domain/ModelDocument');

/** Base class: subclasses declare their routes in routes(). */
class Controller {
  register(router) {
    this.routes().forEach(([method, pattern, handler]) => router.register(method, pattern, handler.bind(this)));
  }

  // eslint-disable-next-line class-methods-use-this
  routes() { return []; }

  static async documentFrom(req) {
    const body = await req.json();
    if (!body || !body.document) throw new HttpError(400, 'Send { "document": { ... } } in the request body.');
    return body.document;
  }
}

class ModelController extends Controller {
  constructor(repository) {
    super();
    this.repository = repository;
  }

  routes() {
    return [
      ['GET', '/api/models', this.list],
      ['GET', '/api/models/:id', this.get],
      ['POST', '/api/models', this.create],
      ['PUT', '/api/models/:id', this.update],
      ['DELETE', '/api/models/:id', this.remove]
    ];
  }

  async list(req, res) { res.json({ models: await this.repository.list() }); }

  async get(req, res) {
    const doc = await this.repository.get(req.params.id);
    if (!doc) throw new HttpError(404, `No saved model with id "${req.params.id}".`);
    res.json({ id: req.params.id, document: doc });
  }

  async create(req, res) {
    res.json(await this.repository.create(await Controller.documentFrom(req)), 201);
  }

  async update(req, res) {
    res.json(await this.repository.save(req.params.id, await Controller.documentFrom(req)));
  }

  async remove(req, res) {
    const removed = await this.repository.remove(req.params.id);
    if (!removed) throw new HttpError(404, `No saved model with id "${req.params.id}".`);
    res.json({ removed: true });
  }
}

class TransformController extends Controller {
  constructor(service) {
    super();
    this.service = service;
  }

  routes() {
    return [
      ['GET', '/api/transform', this.directions],
      ['POST', '/api/transform/:direction', this.transform]
    ];
  }

  async directions(req, res) { res.json({ directions: this.service.directions }); }

  async transform(req, res) {
    const doc = await Controller.documentFrom(req);
    res.json({ document: this.service.run(req.params.direction, doc) });
  }
}

class ToolController extends Controller {
  constructor({ validator, suggester, sqlGenerator }) {
    super();
    this.validator = validator;
    this.suggester = suggester;
    this.sqlGenerator = sqlGenerator;
  }

  routes() {
    return [
      ['GET', '/api/health', this.health],
      ['POST', '/api/import', this.importDocument],
      ['POST', '/api/validate', this.validate],
      ['POST', '/api/suggest/link-names', this.suggest],
      ['POST', '/api/export/sql', this.sql]
    ];
  }

  async health(req, res) { res.json({ status: 'ok', time: new Date().toISOString() }); }

  async importDocument(req, res) {
    const body = await req.json();
    const doc = ModelDocument.from(body.text !== undefined ? body.text : body.document);
    res.json({ document: doc, issues: this.validator.validate(doc) });
  }

  async validate(req, res) {
    const doc = ModelDocument.from(await Controller.documentFrom(req));
    res.json({ issues: this.validator.validate(doc) });
  }

  async suggest(req, res) {
    const { source, target, existing = [] } = await req.json();
    if (!source || !target) throw new HttpError(400, 'Send { source, target, existing }.');
    res.json({ suggestions: this.suggester.suggest(source, target, existing) });
  }

  async sql(req, res) {
    res.json({ sql: this.sqlGenerator.generate(await Controller.documentFrom(req)) });
  }
}

module.exports = { Controller, ModelController, TransformController, ToolController };
