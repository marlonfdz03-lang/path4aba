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

  const SECTION_SELECTOR = 'mat-card';

  const ABAMatrixAdapter = {
    platform: 'abamatrix',

    // ABA Matrix sections are <mat-card> only (no mat-expansion-panel). Skip hidden cards.
    detectSections: function () {
      return Array.from(document.querySelectorAll(SECTION_SELECTOR)).filter(function (el) {
        return el.offsetParent !== null;
      });
    },

    // Buttons whose visible label reads "Add Behavior" or "Add Goal".
    getAddButtons: function () {
      const candidates = Array.from(document.querySelectorAll('button, a[role="button"], .add-event-button'));
      return candidates.filter(function (b) {
        const label = (b.innerText || b.textContent || '').trim();
        return /add\s+behavior|add\s+goal/i.test(label);
      });
    },

    // ABA Matrix cards have NO title elements — detect the section type from the
    // questions rendered inside the card. Takes the section ELEMENT (not a title string).
    // Order matters: DailyLog first, then BehaviorReduction, then GoalImplementation.
    getSectionType: function (sectionEl) {
      const text = (sectionEl && sectionEl.innerText) || '';
      if (text.includes('How did the client present') || text.includes('Who was present') || text.includes('significant changes')) return 'DailyLog';
      if (text.includes('Behavior:') && text.includes('Evidenced By:')) return 'BehaviorReduction';
      if (text.includes('Goal Implementation:') && text.includes('medical barriers')) return 'GoalImplementation';
      return 'Other';
    }
  };

  window.ABAMatrixAdapter = ABAMatrixAdapter;
})();
