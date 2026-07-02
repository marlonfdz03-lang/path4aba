/**
 * Path4ABA Form Engine — Debug entry point (Phase 1)
 *
 * Runs Scanner -> Normalizer and reports the result to the DevTools console.
 * Loaded in the MAIN world so window.debugFormEngine() is callable from the default
 * console context (no need to switch to the extension's isolated context).
 *
 * Usage: open ABA Matrix (app.abamatrix.com/session), open DevTools, run:
 *   window.debugFormEngine()
 *
 * Exposes:
 *   window.debugFormEngine()      -> logs a report and returns the NormalizedForm
 *   window.debugFormEngineData()  -> returns the NormalizedForm silently (no logging)
 */
(function () {
  'use strict';
  if (window.debugFormEngine) return; // idempotent

  function summarize(normalized) {
    const byType = {};
    const bySection = {};
    for (const section of normalized.sections) {
      bySection[section.id + ' (' + section.type + ')'] = section.fields.length;
      for (const f of section.fields) {
        byType[f.fieldType] = (byType[f.fieldType] || 0) + 1;
      }
    }
    return { byType: byType, bySection: bySection };
  }

  function run() {
    const adapter = window.ABAMatrixAdapter || null;
    const raw = window.FormEngineScanner.scan(adapter);
    return window.FormEngineNormalizer.normalize(raw, adapter);
  }

  window.debugFormEngine = function debugFormEngine() {
    if (!window.FormEngineScanner || !window.FormEngineNormalizer) {
      console.error('[Path4ABA] Form engine not loaded (scanner/normalizer missing). Reload the page.');
      return null;
    }

    const normalized = run();
    const totalFields = normalized.sections.reduce(function (n, s) { return n + s.fields.length; }, 0);
    const summary = summarize(normalized);

    console.group('%c[Path4ABA] Form Engine — NormalizedForm', 'font-weight:bold;color:#2563eb;font-size:13px');
    console.log('URL:', normalized.url, '| platform:', normalized.platform);
    console.log('Sections:', normalized.sections.length, '| Fields:', totalFields, '| Unidentified:', normalized.unidentified.length);

    console.groupCollapsed('Full NormalizedForm (JSON)');
    console.log(JSON.stringify(normalized, null, 2));
    console.groupEnd();

    console.log('Fields by type:');
    console.table(summary.byType);
    console.log('Fields by section:');
    console.table(summary.bySection);

    if (normalized.unidentified.length) {
      console.groupCollapsed('%c⚠ ' + normalized.unidentified.length + ' field(s) NOT identified', 'color:#b45309;font-weight:bold');
      console.table(normalized.unidentified);
      console.groupEnd();
    } else {
      console.log('%c✓ All fields identified.', 'color:#15803d;font-weight:bold');
    }
    console.groupEnd();

    return normalized;
  };

  window.debugFormEngineData = function debugFormEngineData() {
    if (!window.FormEngineScanner || !window.FormEngineNormalizer) return null;
    return run();
  };
})();
