/**
 * NamingConvention
 * Implements the "Naming Conventions for Database Modeling" (LAM, CNES 21/09/2023).
 * UMD module: loaded with require() by the backend and as a plain <script> in the browser.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.Modelizer = root.Modelizer || {};
    root.Modelizer.NamingConvention = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UPPER_CAMEL = /^[A-Z][a-zA-Z0-9]*$/;
  const LOWER_CAMEL = /^[a-z][a-zA-Z0-9]*$/;
  const KEY_PREFIX = /^(pkfk|pk|fk)_/;
  const CARDINALITY_PART = '(?:0|1|[2-9]\\d*|\\*|n)';
  const CARDINALITY = new RegExp(`^${CARDINALITY_PART}(?:\\.\\.${CARDINALITY_PART})?$`);

  /** Verbs the convention calls "trivial": they carry little meaning. */
  const TRIVIAL_VERBS = new Set([
    'has', 'have', 'is', 'are', 'be', 'does', 'do', 'gets', 'get', 'makes', 'make',
    'relates', 'related', 'link', 'links', 'connects', 'with', 'of', 'to', 'references'
  ]);

  /** Singular words that end in "s" and must not be flagged as plural. */
  const SINGULAR_S = new Set([
    'status', 'address', 'class', 'access', 'bus', 'campus', 'process', 'business',
    'analysis', 'basis', 'thesis', 'news', 'series', 'species', 'gas', 'bonus', 'focus',
    'census', 'canvas', 'alias', 'atlas', 'radius', 'virus', 'corpus', 'progress', 'success',
    'loss', 'boss', 'glass', 'pass', 'grass', 'chess', 'fitness', 'wellness', 'is', 'has',
    'always', 'lens', 'axis', 'yes', 'this', 'plus', 'minus', 'across', 'afterwards'
  ]);

  class NamingConvention {
    static get TRIVIAL_VERBS() { return TRIVIAL_VERBS; }

    /** "first name" | "first_name" | "FirstName" | "first-name" -> ["first", "name"] */
    static splitWords(text) {
      return String(text || '')
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);
    }

    static capitalize(word) {
      return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
    }

    static lowerFirst(text) {
      return text ? text.charAt(0).toLowerCase() + text.slice(1) : '';
    }

    static upperFirst(text) {
      return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
    }

    static toUpperCamel(text) {
      return NamingConvention.splitWords(text).map((w) => NamingConvention.capitalize(w)).join('')
        .replace(/^[0-9]+/, '');
    }

    static toLowerCamel(text) {
      return NamingConvention.lowerFirst(NamingConvention.toUpperCamel(text));
    }

    /** Keeps an already-valid camelCase segment untouched (e.g. "iso2Code") instead of re-casing it. */
    static keepOrLowerCamel(text) {
      return LOWER_CAMEL.test(text) ? text : NamingConvention.toLowerCamel(text);
    }

    static keepOrUpperCamel(text) {
      return UPPER_CAMEL.test(text) ? text : NamingConvention.toUpperCamel(text);
    }

    static isUpperCamel(text) { return UPPER_CAMEL.test(text || ''); }
    static isLowerCamel(text) { return LOWER_CAMEL.test(text || ''); }
    static isCardinality(text) { return CARDINALITY.test(String(text || '').trim()); }

    static normalizeCardinality(text) {
      const value = String(text || '').trim().replace(/\s+/g, '').replace(/\*/g, 'n');
      if (value === '1..1') return '1';
      return value;
    }

    static lastWord(text) {
      const words = NamingConvention.splitWords(text);
      return (words[words.length - 1] || '').toLowerCase();
    }

    static looksPlural(text) {
      const word = NamingConvention.lastWord(text);
      if (word.length < 4 || SINGULAR_S.has(word)) return false;
      if (/(ss|us|is|ous)$/.test(word)) return false;
      return /(ies|ses|xes|[^s]s)$/.test(word);
    }

    // ---------- builders used by the transformers ----------

    static pkName(name) { return `pk_${NamingConvention.keepOrLowerCamel(name)}`; }

    static fkName(referredTable, verb, role) {
      return ['fk', NamingConvention.keepOrLowerCamel(referredTable), verb, role]
        .filter(Boolean).join('_');
    }

    static pkfkName(referredTable, role) {
      return ['pkfk', NamingConvention.keepOrLowerCamel(referredTable), role].filter(Boolean).join('_');
    }

    static constraintName(sourceTable, verb, targetTable, role) {
      return ['fkc', sourceTable, verb, targetTable, role].filter(Boolean).join('_');
    }

    static indexName(type, fieldName) { return `idx_${type}_${fieldName}`; }

    /** "pk_iso2Code" -> "iso2Code", "fk_country_lives" -> "country_lives" */
    static stripKeyPrefix(name) { return String(name || '').replace(KEY_PREFIX, ''); }

    static keyPrefix(name) {
      const match = String(name || '').match(KEY_PREFIX);
      return match ? match[1] : '';
    }

    /**
     * Parses a key field name.
     * fk_gender_belongs_parentType -> { prefix:'fk', table:'gender', verb:'belongs', role:'parentType' }
     * pkfk_person                  -> { prefix:'pkfk', table:'person', verb:'', role:'' }
     */
    static parseKeyName(name, { association = false } = {}) {
      const prefix = NamingConvention.keyPrefix(name);
      const parts = NamingConvention.stripKeyPrefix(name).split('_').filter(Boolean);
      const result = { prefix, table: parts[0] || '', verb: '', role: '', rest: parts.slice(1) };
      if (prefix === 'pk') return { ...result, table: '', attribute: parts.join('_') };
      if (prefix === 'pkfk' || association) result.role = parts[1] || '';
      else { result.verb = parts[1] || ''; result.role = parts[2] || ''; }
      return result;
    }

    // ---------- normalisation (what the editor "forces") ----------

    /**
     * kind: class | attribute | association | role | table | associationTable | field | column
     *       | constraint | index | routine
     */
    static normalize(kind, raw) {
      const text = String(raw || '').trim();
      switch (kind) {
        case 'class':
        case 'table':
          return NamingConvention.keepOrUpperCamel(text);
        case 'attribute':
        case 'association':
        case 'role':
        case 'associationTable':
          return NamingConvention.keepOrLowerCamel(text);
        case 'field':
        case 'column': {
          const prefix = NamingConvention.keyPrefix(text);
          const rest = NamingConvention.stripKeyPrefix(text);
          if (!prefix) return NamingConvention.keepOrLowerCamel(rest);
          const segments = rest.split('_').filter(Boolean).map((s) => NamingConvention.keepOrLowerCamel(s));
          return [prefix, ...segments].join('_');
        }
        case 'constraint':
        case 'index':
          return text.replace(/\s+/g, '_');
        case 'routine': {
          const match = text.match(/^(vw|sp|fn|tr)_(.*)$/);
          return match ? `${match[1]}_${NamingConvention.keepOrLowerCamel(match[2])}` : text;
        }
        default:
          return text;
      }
    }

    // ---------- validation ----------

    static issue(level, message) { return { level, message }; }

    /**
     * Returns a list of { level: 'error' | 'warning', message }.
     * context: { model: 'cdm'|'ldm'|'pdm', isAssociation: boolean }
     */
    static validate(kind, name, context = {}) {
      const issues = [];
      const add = (level, message) => issues.push(NamingConvention.issue(level, message));
      const value = String(name || '');

      if (!value.trim()) {
        add('error', 'Name is required.');
        return issues;
      }
      if (/\s/.test(value)) add('error', 'Names cannot contain spaces.');

      switch (kind) {
        case 'class':
          if (!UPPER_CAMEL.test(value)) add('error', 'Class names use UpperCamelCase (e.g. TrainingSession).');
          if (NamingConvention.looksPlural(value)) add('warning', `"${value}" looks plural. Class names are singular nouns.`);
          break;
        case 'table':
          if (context.isAssociation) {
            if (!LOWER_CAMEL.test(value)) add('error', 'Association tables keep the association verb in lowerCamelCase.');
          } else if (!UPPER_CAMEL.test(value)) {
            add('error', 'Table names transpose the class name in UpperCamelCase.');
          }
          break;
        case 'associationTable':
          if (!LOWER_CAMEL.test(value)) add('error', 'Association tables keep the association verb in lowerCamelCase.');
          break;
        case 'attribute':
          if (KEY_PREFIX.test(value)) add('error', 'Keys (pk_, fk_) belong to the logical model, not the conceptual one.');
          else if (!LOWER_CAMEL.test(value)) add('error', 'Attribute names use lowerCamelCase (e.g. firstName).');
          if (NamingConvention.looksPlural(value)) add('warning', `"${value}" looks plural. Attribute names are singular nouns.`);
          break;
        case 'association':
          if (!LOWER_CAMEL.test(value)) add('error', 'Association names are verbs in lowerCamelCase (e.g. lives, isLocated).');
          else if (TRIVIAL_VERBS.has(value.toLowerCase())) add('warning', `"${value}" is a trivial verb. Pick one that describes the relationship.`);
          break;
        case 'role':
          if (!LOWER_CAMEL.test(value)) add('error', 'Roles are singular nouns in lowerCamelCase (e.g. parentType).');
          break;
        case 'field':
        case 'column':
          NamingConvention.validateKeyField(value, context, add);
          break;
        case 'constraint':
          if (!/^fkc_[A-Za-z][A-Za-z0-9]*(_[A-Za-z][A-Za-z0-9]*)+$/.test(value)) {
            add('error', 'Foreign key constraints follow fkc_Source_verb_Target (e.g. fkc_Person_lives_Country).');
          }
          break;
        case 'index':
          if (!/^idx_[a-z]+_[a-z][A-Za-z0-9_]*$/.test(value)) {
            add('error', 'Indexes follow idx_<type>_<field> (e.g. idx_unique_email).');
          }
          break;
        case 'routine':
          if (!/^(vw|sp|fn|tr)_[a-z][A-Za-z0-9]*$/.test(value)) {
            add('error', 'Views, procedures, functions and triggers use vw_, sp_, fn_ or tr_ + lowerCamelCase.');
          }
          break;
        default:
          break;
      }
      return issues;
    }

    static validateKeyField(value, context, add) {
      const prefix = NamingConvention.keyPrefix(value);
      const rest = NamingConvention.stripKeyPrefix(value);
      const segments = rest.split('_');
      const badSegment = segments.find((s) => !LOWER_CAMEL.test(s));

      if (!prefix) {
        if (value.includes('_') || !LOWER_CAMEL.test(value)) {
          add('error', 'Field names use lowerCamelCase. Key fields start with pk_, fk_ or pkfk_.');
        }
        if (context.pk) add('error', 'Primary key fields must start with pk_ (or pkfk_ when they are also a foreign key).');
        if (context.fk) add('error', 'Foreign key fields must start with fk_ (or pkfk_ when they are also a primary key).');
        return;
      }
      if (badSegment !== undefined) add('error', `"${badSegment || '(empty)'}" must be lowerCamelCase.`);
      if (prefix === 'pk' && context.fk) add('error', 'This field is also a foreign key: use the pkfk_ prefix.');
      if (prefix === 'fk' && context.pk) add('error', 'This field is also a primary key: use the pkfk_ prefix.');
      if (prefix === 'fk' && !context.isAssociation && segments.length < 2) {
        add('error', 'Foreign keys are named fk_<referredTable>_<verb> (e.g. fk_country_lives).');
      }
      if ((prefix === 'fk' || prefix === 'pkfk') && context.fk === false) {
        add('warning', `${prefix}_ fields should reference another table.`);
      }
      if (prefix === 'pk' && context.pk === false) add('warning', 'pk_ fields should be part of the primary key.');
    }

    static errors(kind, name, context) {
      return NamingConvention.validate(kind, name, context).filter((i) => i.level === 'error');
    }

    /** Makes `name` unique among `taken` by appending a number: name, name2, name3... */
    static unique(name, taken) {
      const set = new Set([...taken].map((n) => String(n).toLowerCase()));
      if (!set.has(name.toLowerCase())) return name;
      let i = 2;
      while (set.has(`${name}${i}`.toLowerCase())) i += 1;
      return `${name}${i}`;
    }
  }

  return NamingConvention;
});
