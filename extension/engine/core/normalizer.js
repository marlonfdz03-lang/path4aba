/**
 * Path4ABA Form Engine — Normalizer (calibrated for ABA Matrix labels)
 *
 * Input:  raw FormSchema from the Scanner (section .type already set during the scan).
 * Output: NormalizedForm with STABLE field IDs.
 *
 * ID format: {SectionPrefix}{Ordinal}_{FieldKey}
 *   DailyLog          -> "DL"   (single section, no ordinal)  e.g. DL_PresentationStart
 *   BehaviorReduction -> "BR"   + ordinal                     e.g. BR3_Antecedent
 *   GoalImplementation-> "Goal" + ordinal                     e.g. Goal2_PromptsUsed
 *   Other             -> "OT"   + ordinal
 *
 * Field keys are matched from the question text against FIELD_KEY_MAP (real ABA Matrix
 * labels). Matching is LONGEST-KEY-FIRST so specific labels win over general ones
 * (e.g. "antecedent interventions:" beats "interventions:"). Colons are preserved during
 * normalization because several keys use ":" to disambiguate.
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

  // Real ABA Matrix question fragments -> canonical field key (from calibration).
  const FIELD_KEY_MAP = {
    'behavior:': 'BehaviorName',
    'evidenced by:': 'EvidencedBy',
    'interventions:': 'Interventions',
    'antecedent interventions:': 'AntecedentInterventions',
    'goal implementation:': 'GoalName',
    'what medical barriers': 'MedicalBarriers',
    'what activities were used': 'Activities',
    'what was the teaching procedure': 'TeachingProcedure',
    'what reinforcers were used': 'Reinforcers',
    'what was the schedule': 'Schedule',
    'how did the client present at the start': 'PresentationStart',
    'how did the client present at the end': 'PresentationEnd',
    'evidenced by': 'EvidencedBy',
    'how was the client': 'Participation',
    'who was present': 'WhoWasPresent',
    'were there any significant changes': 'EnvironmentChanges',
    'were there any incidents': 'Incidents',
    'were there any medical concerns': 'MedicalConcerns',
    'what was the function': 'BehaviorFunction',
    'what prompted the behavior': 'Antecedent',
    'what was the main focus': 'MainFocus',
    'what was the result': 'Result',
    'once the antecedent was presented': 'AntecedentInterventionsYesNo',
    'would you like to add current sto': 'STO',
    'did you use any prompts': 'PromptsUsed'
  };

  // Sorted longest-first so the most specific fragment matches before a shorter substring.
  const FIELD_KEY_ENTRIES = Object.keys(FIELD_KEY_MAP)
    .sort(function (a, b) { return b.length - a.length; })
    .map(function (k) { return [k, FIELD_KEY_MAP[k]]; });

  // Lowercase + collapse whitespace, but PRESERVE punctuation (keys rely on ":").
  function normForMap(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function detectFieldKey(questionText) {
    const q = normForMap(questionText);
    if (!q) return null;
    for (const entry of FIELD_KEY_ENTRIES) {
      if (q.indexOf(entry[0]) !== -1) return entry[1];
    }
    return null;
  }

  function normalize(rawSchema, _adapter) {
    const counters = {};      // sectionType -> running ordinal
    const fieldIndex = {};    // id -> field
    const unidentified = [];
    const sections = [];

    const rawSections = (rawSchema && rawSchema.sections) || [];
    for (const rawSection of rawSections) {
      // Section type is decided during the scan (element-based); trust it here.
      const type = rawSection.type || 'Other';
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
        const matched = detectFieldKey(rawField.questionText);
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
