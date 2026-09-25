'use strict';

/* Checks the transformers against the example in the naming-convention PDF. Run: npm test */
const assert = require('assert');
const TransformationService = require('../src/domain/TransformationService');
const ModelValidator = require('../shared/ModelValidator');

const attr = (id, name, extra = {}) => ({ id, name, ...extra });
const doc = {
  meta: { name: 'Convention example' },
  layout: { shared: { gender: { x: 0, y: 0 }, person: { x: 300, y: 0 }, country: { x: 600, y: 0 } }, pdm: {} },
  cdm: {
    classes: [
      { id: 'gender', name: 'Gender', attributes: [attr('g1', 'name'), attr('g2', 'symbol')] },
      { id: 'person', name: 'Person', attributes: [attr('p1', 'firstname'), attr('p2', 'lastname'), attr('p3', 'dateOfBirth'), attr('p4', 'ssn', { unique: true })] },
      { id: 'country', name: 'Country', attributes: [attr('c1', 'iso2Code', { identifier: true }), attr('c2', 'name')] }
    ],
    associations: [
      { id: 'a1', name: 'identifies', source: { classId: 'gender', cardinality: '1' }, target: { classId: 'person', cardinality: '0..n' } },
      { id: 'a2', name: 'works', source: { classId: 'person', cardinality: '0..n' }, target: { classId: 'country', cardinality: '0..1' } },
      { id: 'a3', name: 'lives', source: { classId: 'person', cardinality: '0..n' }, target: { classId: 'country', cardinality: '1' } },
      { id: 'a4', name: 'isNational', source: { classId: 'person', cardinality: '0..n' }, target: { classId: 'country', cardinality: '1..n' }, associationClass: { attributes: [attr('n1', 'since')] } },
      { id: 'a5', name: 'belongs', source: { classId: 'gender', cardinality: '0..n', role: 'subType' }, target: { classId: 'gender', cardinality: '0..1', role: 'parentType' } }
    ]
  }
};

const service = new TransformationService();
const pdmDoc = service.run('cdm-to-pdm', doc);
const table = (d, name) => d.ldm.tables.find((t) => t.name === name);
const names = (t) => t.fields.map((f) => f.name);

assert.deepStrictEqual(names(table(pdmDoc, 'Person')), ['pk_person', 'firstname', 'lastname', 'dateOfBirth', 'ssn', 'fk_gender_identifies', 'fk_country_works', 'fk_country_lives']);
assert.deepStrictEqual(names(table(pdmDoc, 'Gender')), ['pk_gender', 'name', 'symbol', 'fk_gender_belongs_parentType']);
assert.deepStrictEqual(names(table(pdmDoc, 'Country')), ['pk_iso2Code', 'name']);
assert.deepStrictEqual(names(table(pdmDoc, 'isNational')), ['pkfk_person', 'pkfk_country', 'since']);

const constraintNames = pdmDoc.pdm.constraints.map((c) => c.name).sort();
assert.ok(constraintNames.includes('fkc_Person_lives_Country'), constraintNames.join());
assert.ok(constraintNames.includes('fkc_isNational_Person'));
assert.ok(constraintNames.includes('fkc_Gender_belongs_Gender_parentType'));
const person = pdmDoc.pdm.tables.find((t) => t.name === 'Person');
assert.strictEqual(person.columns.find((c) => c.name === 'fk_country_lives').type, 'VARCHAR(20)');
assert.strictEqual(person.indexes[0].name, 'idx_unique_ssn');

// Reverse: PDM -> CDM must give back the same classes and associations
const back = service.run('pdm-to-cdm', { ...pdmDoc, cdm: { classes: [], associations: [] }, ldm: { tables: [], links: [] } });
assert.deepStrictEqual(back.cdm.classes.map((c) => c.name).sort(), ['Country', 'Gender', 'Person']);
const assoc = Object.fromEntries(back.cdm.associations.map((a) => [a.name, a]));
assert.deepStrictEqual(Object.keys(assoc).sort(), ['belongs', 'identifies', 'isNational', 'lives', 'works']);
assert.strictEqual(assoc.lives.target.cardinality, '1');
assert.strictEqual(assoc.works.target.cardinality, '0..1');
assert.strictEqual(assoc.belongs.target.role, 'parentType');
assert.deepStrictEqual(assoc.isNational.associationClass.attributes.map((a) => a.name), ['since']);
assert.ok(back.cdm.classes.find((c) => c.name === 'Country').attributes.find((a) => a.name === 'iso2Code').identifier);

const issues = new ModelValidator().validate(pdmDoc).filter((i) => i.level === 'error');
assert.deepStrictEqual(issues, [], JSON.stringify(issues, null, 2));
console.log('All transformation tests passed.');
