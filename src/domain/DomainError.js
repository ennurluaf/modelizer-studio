'use strict';

class DomainError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'DomainError';
    this.details = details;
  }
}

class IdGenerator {
  static next(prefix = 'id') {
    const random = require('crypto').randomUUID().replace(/-/g, '').slice(0, 10);
    return `${prefix}_${random}`;
  }
}

module.exports = { DomainError, IdGenerator };
