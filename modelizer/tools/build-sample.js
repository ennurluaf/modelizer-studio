'use strict';

/* Builds public/samples/protraining360.json from a CDM, generating LDM and PDM with the backend. */
const fs = require('fs');
const path = require('path');
const TransformationService = require('../src/domain/TransformationService');

let n = 0;
const a = (name, extra = {}) => ({ id: `att_s${++n}`, name, ...extra });
const cls = (id, name, attributes) => ({ id, name, attributes });
const end = (classId, cardinality, role = '') => ({ classId, cardinality, role });

const cdm = {
  classes: [
    cls('appUser', 'AppUser', [a('email', { unique: true }), a('passwordHash'), a('firstName'), a('lastName'), a('phone'), a('birthDate'), a('isActive'), a('createdAt')]),
    cls('role', 'Role', [a('code', { identifier: true }), a('label')]),
    cls('refreshToken', 'RefreshToken', [a('tokenHash'), a('issuedAt'), a('expiresAt'), a('revokedAt')]),
    cls('club', 'Club', [a('name'), a('email'), a('phone')]),
    cls('sport', 'Sport', [a('name')]),
    cls('infrastructure', 'Infrastructure', [a('name'), a('capacity'), a('address')]),
    cls('trainingSession', 'TrainingSession', [a('title'), a('startAt'), a('endAt'), a('capacity')]),
    cls('equipment', 'Equipment', [a('name'), a('stockQuantity')])
  ],
  associations: [
    { id: 'asc_holds', name: 'holds', source: end('appUser', '0..n'), target: end('role', '1..n'), associationClass: { attributes: [a('assignedAt')] } },
    { id: 'asc_owns', name: 'owns', source: end('appUser', '1'), target: end('refreshToken', '0..n') },
    { id: 'asc_joins', name: 'joins', source: end('appUser', '0..n'), target: end('club', '0..n'), associationClass: { attributes: [a('joinedAt')] } },
    { id: 'asc_operates', name: 'operates', source: end('club', '1'), target: end('infrastructure', '0..n') },
    { id: 'asc_organizes', name: 'organizes', source: end('club', '1'), target: end('trainingSession', '0..n') },
    { id: 'asc_coaches', name: 'coaches', source: end('appUser', '1', 'trainer'), target: end('trainingSession', '0..n') },
    { id: 'asc_registers', name: 'registers', source: end('appUser', '0..n', 'participant'), target: end('trainingSession', '0..n'), associationClass: { attributes: [a('status'), a('registeredAt'), a('cancelledAt')] } },
    { id: 'asc_takesPlace', name: 'takesPlace', source: end('trainingSession', '0..n'), target: end('infrastructure', '1') },
    { id: 'asc_requires', name: 'requires', source: end('trainingSession', '0..n'), target: end('equipment', '0..n'), associationClass: { attributes: [a('quantity')] } },
    { id: 'asc_practises', name: 'isDedicated', source: end('trainingSession', '0..n'), target: end('sport', '1') },
    { id: 'asc_suits', name: 'suits', source: end('infrastructure', '0..n'), target: end('sport', '1..n') }
  ]
};

const layout = {
  shared: {
    role: { x: 60, y: 60 }, asc_holds: { x: 60, y: 300 }, refreshToken: { x: 60, y: 520 },
    appUser: { x: 420, y: 240 }, asc_joins: { x: 760, y: 60 }, club: { x: 1080, y: 60 },
    asc_registers: { x: 560, y: 640 }, trainingSession: { x: 1000, y: 460 },
    infrastructure: { x: 1480, y: 200 }, equipment: { x: 1480, y: 720 }, asc_requires: { x: 1180, y: 800 },
    sport: { x: 1760, y: 460 }, asc_suits: { x: 1800, y: 200 }
  },
  pdm: {}
};

const doc = { meta: { name: 'ProTraining360' }, layout, cdm };
const full = new TransformationService().run('cdm-to-pdm', doc);
const out = path.join(__dirname, '..', 'public', 'samples', 'protraining360.json');
fs.writeFileSync(out, JSON.stringify(full, null, 2));
console.log(`Wrote ${out}`);
console.log(full.ldm.tables.map((t) => `${t.name}: ${t.fields.map((f) => f.name).join(', ')}`).join('\n'));
console.log(full.pdm.constraints.map((c) => c.name).join('\n'));
