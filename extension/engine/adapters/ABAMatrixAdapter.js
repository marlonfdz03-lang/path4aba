/**
 * Path4ABA Form Engine — ABAMatrixAdapter (Phase 1 skeleton)
 *
 * The single seam between the platform-agnostic core and ABA Matrix
 * (app.abamatrix.com). Phase 1 implements only the three interface methods the
 * Scanner/Normalizer/debug flow needs; the fill/execution logic lands in later phases.
 *
 * Interface:
 *   detectSections()        -> Element[]   candidate section containers
 *   getAddButtons()         -> Element[]   "Add Behavior" / "Add Goal" buttons
 *   getSectionType(title)   -> 'DailyLog' | 'BehaviorReduction' | 'GoalImplementation' | 'Other'
 *
 * Exposes: window.ABAMatrixAdapter
 */
(function () {
  'use strict';
  if (window.ABAMatrixAdapter) return; // idempotent

  const SECTION_SELECTOR = 'mat-card, mat-expansion-panel';

  const ABAMatrixAdapter = {
    platform: 'abamatrix',

    // Candidate section containers. Skeleton: generic Angular Material containers.
    detectSections: function () {
      return Array.from(document.querySelectorAll(SECTION_SELECTOR));
    },

    // Buttons whose visible label reads "Add Behavior" or "Add Goal".
    getAddButtons: function () {
      const candidates = Array.from(document.querySelectorAll('button, a[role="button"], .add-event-button'));
      return candidates.filter(function (b) {
        const label = (b.innerText || b.textContent || '').trim();
        return /add\s+behavior|add\s+goal/i.test(label);
      });
    },

    // Map a section's visible title to a section type. Order matters: the specific
    // DailyLog check runs first, then BehaviorReduction, then GoalImplementation.
    getSectionType: function (titleText) {
      const t = (titleText || '').toLowerCase();
      if (/daily\s*log|session\s*summary|client\s*present|general\s*information/.test(t)) return 'DailyLog';
      if (/behavior\s*reduction|behavior|maladaptive|reduction/.test(t)) return 'BehaviorReduction';
      if (/goal\s*implementation|goal|skill|acquisition|implementation/.test(t)) return 'GoalImplementation';
      return 'Other';
    }
  };

  window.ABAMatrixAdapter = ABAMatrixAdapter;
})();
