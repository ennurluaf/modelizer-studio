'use strict';

const fs = require('fs/promises');
const path = require('path');
const ModelDocument = require('../domain/ModelDocument');
const { DomainError, IdGenerator } = require('../domain/DomainError');

/** Stores every document as one JSON file (CDM + LDM + PDM together) in the data directory. */
class ModelRepository {
  constructor(directory) {
    this.directory = directory;
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    return this;
  }

  static assertId(id) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(id || ''))) throw new DomainError('Invalid model id.');
    return id;
  }

  fileOf(id) {
    return path.join(this.directory, `${ModelRepository.assertId(id)}.json`);
  }

  static slug(name) {
    return String(name || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'model';
  }

  async list() {
    const files = (await fs.readdir(this.directory)).filter((f) => f.endsWith('.json'));
    const items = await Promise.all(files.map(async (file) => {
      try {
        const doc = JSON.parse(await fs.readFile(path.join(this.directory, file), 'utf8'));
        return {
          id: file.replace(/\.json$/, ''),
          name: doc.meta ? doc.meta.name : file,
          updatedAt: doc.meta ? doc.meta.updatedAt : null,
          classes: doc.cdm ? doc.cdm.classes.length : 0,
          tables: doc.pdm ? doc.pdm.tables.length : 0
        };
      } catch {
        return null;
      }
    }));
    return items.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async get(id) {
    try {
      return ModelDocument.from(await fs.readFile(this.fileOf(id), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async create(raw) {
    const doc = ModelDocument.from(raw);
    const id = `${ModelRepository.slug(doc.meta.name)}-${IdGenerator.next('m').slice(2, 8)}`;
    return this.save(id, doc);
  }

  async save(id, raw) {
    const doc = ModelDocument.from(raw);
    doc.meta.updatedAt = new Date().toISOString();
    const file = this.fileOf(id);
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(doc, null, 2), 'utf8');
    await fs.rename(temp, file);
    return { id, document: doc };
  }

  async remove(id) {
    try {
      await fs.unlink(this.fileOf(id));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }
}

module.exports = ModelRepository;
