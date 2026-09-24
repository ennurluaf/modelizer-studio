'use strict';

const CdmToLdmTransformer = require('./transformers/CdmToLdmTransformer');
const LdmToPdmTransformer = require('./transformers/LdmToPdmTransformer');
const PdmToLdmTransformer = require('./transformers/PdmToLdmTransformer');
const LdmToCdmTransformer = require('./transformers/LdmToCdmTransformer');
const ModelDocument = require('./ModelDocument');
const { DomainError } = require('./DomainError');

/** Chains transformers into the directions the editor offers. */
class TransformationService {
  constructor() {
    const steps = {
      'cdm-ldm': new CdmToLdmTransformer(),
      'ldm-pdm': new LdmToPdmTransformer(),
      'pdm-ldm': new PdmToLdmTransformer(),
      'ldm-cdm': new LdmToCdmTransformer()
    };
    this.pipelines = new Map([
      ['cdm-to-ldm', [steps['cdm-ldm']]],
      ['ldm-to-pdm', [steps['ldm-pdm']]],
      ['cdm-to-pdm', [steps['cdm-ldm'], steps['ldm-pdm']]],
      ['pdm-to-ldm', [steps['pdm-ldm']]],
      ['ldm-to-cdm', [steps['ldm-cdm']]],
      ['pdm-to-cdm', [steps['pdm-ldm'], steps['ldm-cdm']]]
    ]);
  }

  get directions() {
    return [...this.pipelines.keys()];
  }

  run(direction, rawDocument) {
    const pipeline = this.pipelines.get(direction);
    if (!pipeline) {
      throw new DomainError(`Unknown direction "${direction}". Use one of: ${this.directions.join(', ')}.`);
    }
    const start = ModelDocument.from(rawDocument);
    const result = pipeline.reduce((doc, transformer) => transformer.transform(doc), start);
    return ModelDocument.from(result);
  }
}

module.exports = TransformationService;
