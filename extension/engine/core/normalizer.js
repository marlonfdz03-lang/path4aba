/**
 * Path4ABA Form Engine — Normalizer (Phase 1)
 *
 * Input:  raw FormSchema from the Scanner.
 * Output: NormalizedForm with STABLE field IDs.
 *
 * ID format: {SectionPrefix}{Ordinal}_{FieldKey}
 *   DailyLog          -> "DL"   (single section, no ordinal)  e.g. DL_ClientPresStart
 *   BehaviorReduction -> "BR"   + ordinal                     e.g. BR3_Antecedent
 *   GoalImplementation-> "Goal" + ordinal                     e.g. Goal2_Prompts
 *   Other             -> "OT"   + ordinal
 *
 * Field keys are detected by fuzzy-matching the question text against ordered rule sets
 * (first match wins — specific rules precede general ones). Unmatched fields get
 * fieldKey "Unknown" and identified=false so they surface in debug output.
 *
 * Exposes: window.FormEngineNormalizer.normalize(rawSchema, adapter) -> NormalizedForm
 */
(function () {
  'use strict';
  if (window.FormEngineNormalizer) return; // idempotent

  const SECTION_PREFIX = {
    DailyLog: 'DL',
    BehaviorReduction: 'BR',
    GoalImplementation: 'Goal',
    Other: 'OT'
  };

  // Ordered rules. all[] = every token must be present; any[] = at least one; notAll[] =
  // reject if every token present. Tokens are matched against the normalized question text.
  const KEY_RULES = {
    DailyLog: [
      { key: 'ClientPresStart', all: ['present'], any: ['start', 'beginning', 'arriv'] },
      { key: 'EvidencedByStart', all: ['evidenc'], any: ['start', 'beginning'] },
      { key: 'ClientPresEnd', all: ['present'], any: ['end', 'conclus', 'leav', 'depart'] },
      { key: 'EvidencedByEnd', all: ['evidenc'], any: ['end', 'conclus'] },
      { key: 'EvidencedBy', any: ['evidenc'] },
      { key: 'Participation', any: ['participat', 'engagement'] },
      { key: 'Incidents', any: ['incident'] },
      { key: 'MedicalConcerns', any: ['medical'] },
      { key: 'SignificantChanges', any: ['significant', 'changes'] },
      { key: 'CaregiversPresent', any: ['caregiver', 'who was present', 'present during'] }
    ],
    BehaviorReduction: [
      { key: 'AntecedentInterventions', all: ['antecedent'], any: ['intervention', 'prevent', 'strateg'] },
      { key: 'ConsequenceInterventions', any: ['after the behavior', 'consequence'], notAll: ['antecedent'] },
      { key: 'Antecedent', any: ['antecedent', 'prompted the behavior', 'what prompted', 'trigger'] },
      { key: 'Function', any: ['function'] },
      { key: 'EvidencedBy', any: ['evidenc', 'observable'] },
      { key: 'MainFocus', any: ['main focus', 'focus of'] },
      { key: 'Result', any: ['result', 'outcome'] },
      { key: 'Interventions', any: ['intervention'] },
      { key: 'BehaviorName', any: ['behavior name', 'name of the behavior', 'select behavior', 'behavior'] }
    ],
    GoalImplementation: [
      { key: 'MedicalBarriers', any: ['medical barrier', 'barrier'] },
      { key: 'Activities', any: ['activit'] },
      { key: 'TeachingProcedure', any: ['teaching', 'procedure', 'how did you teach'] },
      { key: 'Prompts', any: ['prompt'] },
      { key: 'Reinforcers', any: ['reinforcer', 'reinforcement used', 'reward'] },
      { key: 'ReinforcementSchedule', any: ['schedule'] },
      { key: 'GoalName', any: ['goal name', 'name of the goal', 'select goal', 'goal', 'skill'] }
    ],
    Other: []
  };

  function norm(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function detectFieldKey(sectionType, questionText) {
    const rules = KEY_RULES[sectionType] || [];
    const q = norm(questionText);
    if (!q) return null;
    for (const rule of rules) {
      if (rule.all && !rule.all.every(function (w) { return q.indexOf(w) !== -1; })) continue;
      if (rule.any && !rule.any.some(function (w) { return q.indexOf(w) !== -1; })) continue;
      if (rule.notAll && rule.notAll.every(function (w) { return q.indexOf(w) !== -1; })) continue;
      return rule.key;
    }
    return null;
  }

  function normalize(rawSchema, adapter) {
    const counters = {};      // sectionType -> running ordinal
    const fieldIndex = {};    // id -> field
    const unidentified = [];
    const sections = [];

    const rawSections = (rawSchema && rawSchema.sections) || [];
    for (const rawSection of rawSections) {
      // Re-derive the type from the adapter when possible (source of truth), else trust the scan.
      let type = rawSection.type || 'Other';
      if (adapter && typeof adapter.getSectionType === 'function' && rawSection.title) {
        try { type = adapter.getSectionType(rawSection.title) || type; } catch (e) { /* keep scan type */ }
      }

      const prefix = SECTION_PREFIX[type] || 'OT';
      let sectionId, ordinal;
      if (type === 'DailyLog') {
        counters.DailyLog = (counters.DailyLog || 0) + 1;
        ordinal = counters.DailyLog;
        sectionId = ordinal === 1 ? 'DL' : 'DL' + ordinal; // single Daily Log stays "DL"
      } else {
        counters[type] = (counters[type] || 0) + 1;
        ordinal = counters[type];
        sectionId = prefix + ordinal;
      }

      const fields = [];
      const keyCounts = {}; // disambiguate repeated keys within one section
      const rawFields = rawSection.fields || [];
      for (const rawField of rawFields) {
        const matched = detectFieldKey(type, rawField.questionText);
        let fieldKey, id, identified;
        if (matched) {
          keyCounts[matched] = (keyCounts[matched] || 0) + 1;
          fieldKey = matched;
          id = keyCounts[matched] === 1 ? sectionId + '_' + matched : sectionId + '_' + matched + keyCounts[matched];
          identified = true;
        } else {
          keyCounts.Unknown = (keyCounts.Unknown || 0) + 1;
          fieldKey = 'Unknown';
          id = sectionId + '_Unknown' + keyCounts.Unknown;
          identified = false;
        }

        const field = {
          id: id,
          fieldKey: fieldKey,
          questionText: rawField.questionText,
          fieldType: rawField.fieldType,
          currentValue: rawField.currentValue,
          options: rawField.options,
          visible: rawField.visible,
          identified: identified,
          locator: { questionText: rawField.questionText, sectionTitle: rawSection.title }
        };
        fields.push(field);
        fieldIndex[id] = field;
        if (!identified) {
          unidentified.push({
            id: id,
            sectionId: sectionId,
            sectionType: type,
            questionText: rawField.questionText,
            fieldType: rawField.fieldType
          });
        }
      }

      sections.push({ id: sectionId, type: type, ordinal: ordinal, title: rawSection.title, fields: fields });
    }

    return {
      platform: (rawSchema && rawSchema.platform) || 'unknown',
      url: (rawSchema && rawSchema.url) || (typeof location !== 'undefined' ? location.href : ''),
      normalizedAt: new Date().toISOString(),
      sections: sections,
      fieldIndex: fieldIndex,
      unidentified: unidentified
    };
  }

  window.FormEngineNormalizer = { normalize: normalize };
})();
