/**
 * LinkNameSuggester
 * Suggests meaningful association verbs (3rd person singular, lowerCamelCase)
 * from the names of the two classes being linked.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./NamingConvention'));
  } else {
    root.Modelizer = root.Modelizer || {};
    root.Modelizer.LinkNameSuggester = factory(root.Modelizer.NamingConvention);
  }
})(typeof self !== 'undefined' ? self : this, function (NamingConvention) {
  'use strict';

  /** A category is recognised from the words of a class name. Order matters: first match wins. */
  const CATEGORIES = [
    { key: 'credential', pattern: /^(token|key|credential|certificate|licen[cs]e|password|secret|apikey)$/ },
    { key: 'role', pattern: /^(role|permission|right|privilege|scope|profile)$/ },
    { key: 'event', pattern: /^(session|event|course|lesson|training|match|game|meeting|appointment|workout|exam|tournament|competition|shift|trip|flight|screening|show|performance)$/ },
    { key: 'booking', pattern: /^(registration|reservation|booking|ticket|order|subscription|enrolment|enrollment|application|request)$/ },
    { key: 'place', pattern: /^(country|city|address|room|location|place|venue|infrastructure|building|field|court|site|region|hall|gym|pitch|pool|track|facility|seat|cinema|stadium|warehouse|zone)$/ },
    { key: 'group', pattern: /^(club|team|group|organi[sz]ation|company|association|department|community|school|class|squad|federation|league|faculty)$/ },
    { key: 'resource', pattern: /^(equipment|device|tool|item|resource|material|product|article|asset|machine|vehicle|ball|gear|book|film|movie)$/ },
    { key: 'money', pattern: /^(invoice|payment|bill|fee|price|contract|transaction|receipt|salary|budget|account)$/ },
    { key: 'document', pattern: /^(report|document|file|note|comment|review|message|post|photo|image|attachment|result|score|evaluation|feedback)$/ },
    { key: 'category', pattern: /^(type|category|gender|kind|status|level|genre|sport|discipline|tag|label|language|nationality)$/ },
    { key: 'time', pattern: /^(date|period|season|schedule|slot|timeslot|day|week|calendar|availability|term|semester)$/ },
    { key: 'actor', pattern: /^(user|person|member|player|athlete|customer|client|employee|student|participant|coach|trainer|owner|admin|administrator|manager|teacher|staff|guest|visitor|author|organizer|organiser|doctor|patient)$/ }
  ];

  /** Verbs describing "<source> ___ <target>" keyed by target category, then by source category. */
  const VERBS = {
    credential: { actor: ['owns', 'uses', 'requests'], default: ['issues', 'authenticates', 'secures'] },
    role: { actor: ['holds', 'isAssigned', 'plays'], default: ['grants', 'requires', 'defines'] },
    event: {
      actor: ['registers', 'attends', 'coaches', 'organizes', 'participates'],
      group: ['organizes', 'hosts', 'schedules'],
      resource: ['isUsedIn', 'isReservedFor'],
      place: ['hosts', 'accommodates'],
      default: ['schedules', 'includes', 'precedes']
    },
    booking: { actor: ['places', 'submits', 'cancels'], event: ['receives', 'accepts'], default: ['concerns', 'generates'] },
    place: {
      actor: ['lives', 'works', 'visits'],
      event: ['takesPlace', 'isLocated', 'occupies'],
      group: ['operates', 'rents', 'isLocated'],
      resource: ['isStored', 'isLocated'],
      place: ['contains', 'borders'],
      default: ['isLocated', 'occupies', 'uses']
    },
    group: { actor: ['joins', 'manages', 'founds', 'leads'], event: ['isOrganizedBy'], default: ['belongs', 'isAffiliated', 'sponsors'] },
    resource: {
      actor: ['borrows', 'reserves', 'uses', 'owns'],
      event: ['requires', 'uses', 'reserves'],
      group: ['owns', 'provides', 'rents'],
      place: ['stores', 'provides'],
      default: ['uses', 'requires', 'consumes']
    },
    money: { actor: ['pays', 'signs', 'receives'], default: ['bills', 'settles', 'generates'] },
    document: { actor: ['writes', 'publishes', 'reads', 'uploads'], default: ['produces', 'attaches', 'describes'] },
    category: { default: ['isClassified', 'isOfType', 'identifies'], actor: ['practises', 'isClassified'] },
    time: { default: ['occursIn', 'isPlannedIn', 'isAvailable'] },
    actor: {
      actor: ['supervises', 'coaches', 'manages', 'invites', 'follows'],
      group: ['employs', 'registers', 'represents'],
      event: ['isLedBy', 'invites'],
      default: ['assigns', 'notifies', 'serves']
    },
    default: { actor: ['creates', 'manages', 'owns'], default: ['concerns', 'describes', 'involves', 'determines'] }
  };

  const REFLEXIVE = ['belongs', 'reportsTo', 'follows', 'replaces', 'includes', 'precedes'];

  class LinkNameSuggester {
    constructor(convention = NamingConvention) {
      this.convention = convention;
    }

    categorize(className) {
      const words = this.convention.splitWords(className).map((w) => w.toLowerCase());
      // The head noun (last word) is the most meaningful one: "TrainingSession" is a session.
      for (const word of [...words].reverse()) {
        const singular = word.replace(/ies$/, 'y').replace(/s$/, '');
        const hit = CATEGORIES.find((c) => c.pattern.test(word) || c.pattern.test(singular));
        if (hit) return hit.key;
      }
      return 'default';
    }

    /**
     * @param {string} sourceName class that "does" the verb
     * @param {string} targetName class the verb points to
     * @param {string[]} existingNames association names already used (they must stay unique)
     * @returns {string[]} up to `limit` suggestions, best first
     */
    suggest(sourceName, targetName, existingNames = [], limit = 6) {
      const taken = new Set(existingNames.map((n) => String(n).toLowerCase()));
      const candidates = [];

      if (sourceName && sourceName === targetName) {
        candidates.push(...REFLEXIVE);
      } else {
        const sourceKind = this.categorize(sourceName);
        const targetKind = this.categorize(targetName);
        const table = VERBS[targetKind] || VERBS.default;
        candidates.push(...(table[sourceKind] || []), ...(table.default || []));
        // The reverse reading often gives a good verb as well ("Club hosts TrainingSession").
        const reverse = VERBS[sourceKind] || VERBS.default;
        candidates.push(...(reverse[targetKind] || []));
        candidates.push(...VERBS.default.default);
      }

      const result = [];
      const push = (name) => {
        if (!name || taken.has(name.toLowerCase()) || result.includes(name)) return;
        if (this.convention.TRIVIAL_VERBS.has(name.toLowerCase())) return;
        result.push(name);
      };
      candidates.forEach(push);

      // Association names must be unique in the model: offer verb + role noun when verbs are taken.
      if (result.length < limit) {
        const noun = this.convention.upperFirst(this.convention.toLowerCamel(
          this.convention.splitWords(targetName).slice(-1)[0] || targetName
        ));
        candidates.forEach((verb) => push(`${verb}${noun}`));
      }
      return result.slice(0, limit);
    }
  }

  return LinkNameSuggester;
});
