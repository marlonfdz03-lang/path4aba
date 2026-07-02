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

    // Daily Log fields are form-level (NOT inside a mat-card); Behavior/Goal sections
    // ARE mat-cards. Returns descriptors { element, type, title, synthetic? } — the
    // synthetic Daily Log points at the <form>, scanned with a mat-card exclusion filter.
    detectSections: function () {
      const sections = [];

      // Daily Log — the real <form> element, marked synthetic.
      const form = document.querySelector('form');
      if (form) {
        const hasDailyLogFields = form.querySelector('mat-form-field:not(mat-card mat-form-field), mat-radio-group:not(mat-card mat-radio-group)');
        if (hasDailyLogFields) {
          sections.push({ element: form, type: 'DailyLog', title: 'Daily Log', synthetic: true });
        }
      }

      // Behavior Reduction / Goal Implementation — visible mat-cards.
      document.querySelectorAll(SECTION_SELECTOR).forEach((card, i) => {
        if (card.offsetParent === null) return;
        const type = this.getSectionType(card);
        const title = (card.innerText && card.innerText.split('\n')[0].trim()) || ('Section ' + i);
        sections.push({ element: card, type: type, title: title });
      });

      return sections;
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
