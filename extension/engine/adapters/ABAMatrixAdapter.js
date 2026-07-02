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
  // Always overwrite on (re)injection — no idempotency guard — so a fresh injection
  // during calibration installs the latest code instead of keeping a stale definition.
  window.__FormEngine_v = (window.__FormEngine_v || 0) + 1;

  const SECTION_SELECTOR = 'mat-card';

  const ABAMatrixAdapter = {
    platform: 'abamatrix',

    // ABA Matrix renders ~21 separate <form> elements: each Daily Log question is its own
    // <form>, while Behavior/Goal live in mat-cards (inside their own forms). Returns
    // descriptors { element, type, title, synthetic?, multiForm? }; the Daily Log descriptor
    // carries an ARRAY of forms (multiForm) bundled into one section.
    detectSections: function () {
      const sections = [];
      const allForms = Array.from(document.querySelectorAll('form'));

      // Daily Log — every visible form with controls NOT inside a mat-card, bundled as one
      // section. seenControls dedups nested/duplicate forms: each control is claimed by the
      // first form that owns it, so a wrapping form can't re-emit a child form's controls.
      const seenControls = new Set();
      const dailyLogForms = allForms.filter(f => {
        if (f.offsetParent === null) return false;
        const controls = Array.from(f.querySelectorAll('mat-form-field, mat-radio-group'))
          .filter(el => !el.closest('mat-card'));
        if (controls.length === 0) return false;
        if (seenControls.has(controls[0])) return false;
        controls.forEach(el => seenControls.add(el));
        return true;
      });
      if (dailyLogForms.length > 0) {
        sections.push({
          element: dailyLogForms,   // array of forms
          type: 'DailyLog',
          title: 'Daily Log',
          synthetic: true,
          multiForm: true
        });
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
