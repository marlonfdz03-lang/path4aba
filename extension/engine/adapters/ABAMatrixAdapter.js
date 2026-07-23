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

    // Add buttons are <button class="add-event-button"> with empty text (no label to match).
    // Order: [0] = Add Behavior Reduction, [1] = Add Goal Implementation.
    getAddButtons: function () {
      return Array.from(document.querySelectorAll('button.add-event-button'))
        .filter(function (b) { return b.offsetParent !== null; });
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
    },

    // Read the host app's OWN validation feedback after a fill (Rule 4) — this is the ground
    // truth, not our own success count. Parses BOTH the section index (numeric missing-count
    // badge or a completion check per section) AND any "Validation Errors" modal (messages as
    // list items), generically — no hardcoded section names or message strings. Also collects
    // ng-invalid / aria-invalid controls, mapping each to a normalizer stableId where possible.
    // Returns { sections: [{ name, missingCount }], messages: [string], invalidFields: [...] }.
    readValidationState: function () {
      var result = { sections: [], messages: [], invalidFields: [] };
      var seen = new Set();

      var toInt = function (s) {
        var m = String(s || '').trim().match(/^\d{1,3}$/);
        return m ? parseInt(m[0], 10) : null;
      };
      var pushSection = function (label, count) {
        var name = (label || '').replace(/\s+/g, ' ').trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        result.sections.push({ name: name, missingCount: count });
      };
      var badgeSel = '.mat-badge-content, [class*="badge"], [class*="Badge"], [class*="count"], [class*="Count"]';

      // 1) Section index. ABA Matrix renders it as:
      //      .nav  >  .nav-item  >  a.nav-link[href^="/session#"]
      // Anchor ONLY on the stable class/href parts — NEVER the Angular build-generated
      // ng-tns-*/_ngcontent-*/ng-star-inserted classes, which change on every deploy.
      // Per item: numeric badge -> missingCount; else a completion/check icon -> 0;
      //           neither present -> null (unknown — never assumed 0).
      var anchors = document.querySelectorAll('.nav .nav-item a.nav-link[href^="/session#"]');
      if (!anchors.length) anchors = document.querySelectorAll('.nav-item a.nav-link[href^="/session#"]');
      anchors.forEach(function (anchor) {
        if (anchor.offsetParent === null) return;

        // missingCount from the numeric badge inside the anchor.
        var missingCount = null;
        var badge = anchor.querySelector(badgeSel);
        var badgeCount = badge ? toInt(badge.innerText || badge.textContent) : null;
        if (badgeCount === null) {
          // Fallback: a LEAF descendant whose entire text is a small integer (a badge with no
          // recognizable class). Never the anchor's own combined text.
          var kids = anchor.querySelectorAll('*');
          for (var i = 0; i < kids.length; i++) {
            if (kids[i].children && kids[i].children.length) continue;
            var n = toInt(kids[i].innerText || kids[i].textContent);
            if (n !== null) { badgeCount = n; break; }
          }
        }

        if (badgeCount !== null) {
          missingCount = badgeCount;
        } else {
          var mark = anchor.querySelector('mat-icon, svg, [class*="check"], [class*="complete"], [class*="done"], [class*="valid"]');
          if (mark) {
            var hint = ((mark.className || '') + ' ' + (mark.innerText || mark.textContent || '')).toLowerCase();
            if (/check|complete|done|valid/.test(hint)) missingCount = 0;
          }
        }

        // Section name: the anchor's text with the badge number / icon-glyph lines stripped out.
        var name = (anchor.innerText || '').split('\n').map(function (l) { return l.trim(); })
          .filter(function (l) { return l && toInt(l) === null; }).join(' ');
        pushSection(name, missingCount);
      });

      // 3) "Validation Errors" modal — collect its list-item messages generically. Only visible
      // dialog/overlay containers are considered; message strings are not hardcoded.
      var seenMsg = new Set();
      document.querySelectorAll('[role="dialog"], [role="alertdialog"], .mat-dialog-container, .mat-mdc-dialog-container, .cdk-dialog-container').forEach(function (dlg) {
        if (dlg.offsetParent === null) return;
        dlg.querySelectorAll('li, [role="alert"], [class*="error"], [class*="message"]').forEach(function (item) {
          var msg = (item.innerText || '').replace(/\s+/g, ' ').trim();
          if (msg.length > 3 && !seenMsg.has(msg)) { seenMsg.add(msg); result.messages.push(msg); }
        });
      });

      // 4) Angular-invalid / aria-invalid controls -> map to normalizer stableIds where possible.
      // Restrict to real control elements so the form/formGroup ng-invalid propagation isn't noise.
      var norm = window.__p4NormalizedForm;
      var index = (norm && norm.fieldIndex) || {};
      var frag = function (s) { return (s || '').trim().toLowerCase().slice(0, 20); };
      var seenInvalid = new Set();
      var invalidSel = [
        'input.ng-invalid', 'textarea.ng-invalid', 'mat-select.ng-invalid', 'mat-radio-group.ng-invalid',
        '[aria-invalid="true"]'
      ].join(', ');
      document.querySelectorAll(invalidSel).forEach(function (el) {
        if (el.offsetParent === null) return;
        var host = el.closest('mat-form-field') || el.parentElement;
        var lbl = host && host.querySelector('mat-label, label, strong, b, p');
        var q = (lbl && (lbl.innerText || '').trim()) || '';
        var stableId = null;
        if (q) {
          for (var id in index) {
            var f = index[id];
            if (f && f.questionText && frag(f.questionText) && frag(f.questionText) === frag(q)) { stableId = id; break; }
          }
        }
        var key = stableId || q;
        if (!key || seenInvalid.has(key)) return;
        seenInvalid.add(key);
        result.invalidFields.push({ stableId: stableId, label: q || null });
      });

      return result;
    },

    // Issue 1d: DEBUG-ONLY, DESTRUCTIVE audit. For every radio in the form, set each option and
    // observe (before vs after) whether it reveals additional REQUIRED controls — so we can find
    // conditional-pair fields before they cause validation errors in production. Detects pairs by
    // observing the DOM, never by hardcoding which radios have children. Returns
    //   [{ radio, option, reveals: [{ tag, label, required }] }]
    // The caller (executor) runs this only under DEBUG and AFTER the real fill, since it toggles
    // radios and leaves the form probed.
    detectConditionalPairs: async function () {
      var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      var textOf = function (el) {
        return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
      };

      // Value-bearing controls in a scope that are REQUIRED (required attr / aria-required, or a
      // mat-form-field required marker), and currently visible.
      var requiredControls = function (scope) {
        var out = [];
        if (!scope) return out;
        scope.querySelectorAll('textarea, input:not([type="hidden"]):not([type="radio"]), mat-select').forEach(function (el) {
          if (el.offsetParent === null) return;
          var ff = el.closest('mat-form-field');
          var required = !!(el.required
            || (el.getAttribute && el.getAttribute('aria-required') === 'true')
            || (ff && ff.querySelector('.mat-form-field-required-marker, .mat-mdc-form-field-required-marker')));
          if (required) out.push(el);
        });
        return out;
      };
      var describe = function (el) {
        var ff = el.closest('mat-form-field');
        var lbl = ff && ff.querySelector('mat-label, label, strong, b, p');
        return { tag: (el.tagName || '').toLowerCase(), label: (lbl && textOf(lbl)) || null, required: true };
      };
      var groupLabel = function (group) {
        var prev = group.previousElementSibling;
        for (var d = 0; d < 3 && prev; d++, prev = prev.previousElementSibling) {
          var t = textOf(prev);
          if (t && t.length > 3) return t.split('\n')[0];
        }
        return textOf(group).split('\n')[0] || 'radio';
      };

      var pairs = [];
      var groups = Array.from(document.querySelectorAll('mat-radio-group'));
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (group.offsetParent === null) continue;
        var scope = group.closest('mat-card, form') || document.body;
        var label = groupLabel(group);
        var buttons = Array.from(group.querySelectorAll('mat-radio-button'));
        for (var b = 0; b < buttons.length; b++) {
          var beforeEls = requiredControls(scope);
          var input = buttons[b].querySelector('input[type="radio"]') || buttons[b].querySelector('input');
          if (input) input.click(); else buttons[b].click();
          await wait(400);
          var afterEls = requiredControls(scope);
          var revealed = afterEls.filter(function (el) { return beforeEls.indexOf(el) === -1; });
          if (revealed.length) {
            pairs.push({ radio: label, option: textOf(buttons[b]), reveals: revealed.map(describe) });
          }
        }
      }
      return pairs;
    }
  };

  window.ABAMatrixAdapter = ABAMatrixAdapter;
})();
