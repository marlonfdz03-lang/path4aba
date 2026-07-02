/**
 * Path4ABA Form Engine — Scanner (calibrated for ABA Matrix DOM)
 *
 * Walks the live DOM of a form and emits a raw, platform-agnostic FormSchema.
 * Design rules:
 *   - NO indexes in the output. A field's only locators are its questionText and
 *     its sectionTitle.
 *   - Output is pure serializable data (no DOM node references).
 *
 * ABA Matrix specifics (from calibration):
 *   - Sections are <mat-card> with NO title element; the section TYPE is decided by
 *     the adapter from the card's inner text, during the scan (element in hand).
 *   - Each question is a <mat-label> inside a <mat-form-field>; the control inside
 *     (mat-select / textarea / input / chip input) gives the field type.
 *   - Yes/No questions are <mat-radio-group> preceded by a <strong> or <p> question.
 *
 * Exposes: window.FormEngineScanner.scan(adapter) -> FormSchema
 */
(function () {
  'use strict';
  if (window.FormEngineScanner) return; // idempotent — defines only, no side effects

  const SECTION_SELECTOR = 'mat-card';

  // Straggler controls (not in a mat-form-field, not a radio group) — a safety net so
  // nothing visible is silently dropped.
  const CONTROL_SELECTOR = [
    'mat-select',
    'mat-checkbox',
    'textarea',
    'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'
  ].join(', ');

  function text(el) {
    return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function looksLikeQuestion(t) {
    const s = (t || '').trim();
    if (s.length < 3 || s.length > 240) return false;
    return /[a-zA-Z]/.test(s);
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function detectFieldType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'mat-select') return 'select';
    if (tag === 'mat-radio-group') return 'radio';
    if (tag === 'mat-checkbox') return 'checkbox';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'input') {
      const cls = el.className || '';
      if (/mat-chip/i.test(cls) || el.closest('mat-chip-list, mat-chip-grid, mat-chip-list-input')) return 'chip';
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'date') return 'date';
      if (t === 'number') return 'number';
      return 'text';
    }
    return 'unknown';
  }

  function getOptions(el, type) {
    if (type === 'radio') {
      return Array.from(el.querySelectorAll('mat-radio-button')).map(function (b) {
        const input = b.querySelector('input');
        return { label: text(b), value: (input && input.value) || text(b) };
      }).filter(function (o) { return o.label; });
    }
    if (type === 'checkbox') {
      const label = text(el);
      return label ? [{ label: label, value: 'true' }] : [];
    }
    if (type === 'select') {
      // mat-option nodes render only while the panel is open. Best-effort read.
      const panelId = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
      let opts = [];
      if (panelId) {
        const panel = document.getElementById(panelId);
        if (panel) opts = Array.from(panel.querySelectorAll('mat-option'));
      }
      return opts.map(function (o) { return { label: text(o), value: text(o) }; })
        .filter(function (o) { return o.label; });
    }
    return undefined;
  }

  function getCurrentValue(el, type) {
    if (type === 'select') {
      const v = el.querySelector('.mat-select-value-text, .mat-mdc-select-value-text, .mat-select-value');
      return text(v) || null;
    }
    if (type === 'radio') {
      const checked = el.querySelector('mat-radio-button.mat-radio-checked, mat-radio-button.mat-mdc-radio-checked');
      if (checked) return text(checked);
      const input = el.querySelector('input:checked');
      return input ? (text(input.closest('mat-radio-button')) || input.value) : null;
    }
    if (type === 'checkbox') {
      const input = el.querySelector('input');
      return input && input.checked ? 'true' : 'false';
    }
    return ('value' in el ? el.value : '') || null;
  }

  // The control that carries the value inside a mat-form-field (priority order).
  function controlOf(formField) {
    return formField.querySelector('mat-select')
      || formField.querySelector('textarea')
      || formField.querySelector('input:not([type="hidden"])');
  }

  // Question for a mat-radio-group: the nearest preceding <strong>/<p> (or label), by proximity.
  function findRadioQuestion(rg) {
    const LABELISH = 'strong, b, p, label, mat-label';
    let node = rg;
    for (let depth = 0; depth < 5 && node && node !== document.body; depth++) {
      let sib = node.previousElementSibling;
      let guard = 0;
      while (sib && guard++ < 8) {
        if (sib.matches && sib.matches(LABELISH)) {
          const t = text(sib);
          if (looksLikeQuestion(t)) return t;
        }
        const inner = sib.querySelector && sib.querySelector(LABELISH);
        if (inner) {
          const t = text(inner);
          if (looksLikeQuestion(t)) return t;
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  // Proximity question finder for straggler controls (not in a form-field / radio group).
  function findQuestionText(control) {
    const ff = control.closest('mat-form-field');
    if (ff) {
      const t = text(ff.querySelector('mat-label, label, .mat-form-field-label'));
      if (looksLikeQuestion(t)) return t;
    }
    const LABELISH = 'mat-label, label, .mat-form-field-label, strong, b, p';
    let node = control;
    for (let depth = 0; depth < 6 && node && node !== document.body; depth++) {
      let sib = node.previousElementSibling;
      let guard = 0;
      while (sib && guard++ < 8) {
        if (sib.matches && sib.matches(LABELISH)) {
          const t = text(sib);
          if (looksLikeQuestion(t)) return t;
        }
        const inner = sib.querySelector && sib.querySelector(LABELISH);
        if (inner) {
          const t = text(inner);
          if (looksLikeQuestion(t)) return t;
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    const aria = (control.getAttribute && (control.getAttribute('aria-label') || control.getAttribute('placeholder'))) || '';
    return looksLikeQuestion(aria) ? aria.trim() : '';
  }

  function buildField(questionText, type, control, sectionTitle) {
    return {
      questionText: questionText || '',
      fieldType: type,
      currentValue: control ? getCurrentValue(control, type) : null,
      options: control ? getOptions(control, type) : undefined,
      visible: control ? isVisible(control) : false,
      sectionTitle: sectionTitle || ''
    };
  }

  // Extract every field in one section, scoped so nested cards don't steal each other's fields.
  function extractFields(sectionEl, sectionTitle) {
    const fields = [];
    const counted = new Set();

    // 1) mat-form-field: mat-label is the question; inner control gives the type.
    for (const ff of sectionEl.querySelectorAll('mat-form-field')) {
      if (ff.closest(SECTION_SELECTOR) !== sectionEl) continue; // belongs to a nested card
      const control = controlOf(ff);
      const type = control ? detectFieldType(control) : 'unknown';
      if (control) counted.add(control);
      fields.push(buildField(text(ff.querySelector('mat-label')), type, control, sectionTitle));
    }

    // 2) mat-radio-group: question is a preceding strong/p.
    for (const rg of sectionEl.querySelectorAll('mat-radio-group')) {
      if (rg.closest(SECTION_SELECTOR) !== sectionEl) continue;
      counted.add(rg);
      fields.push(buildField(findRadioQuestion(rg), 'radio', rg, sectionTitle));
    }

    // 3) Stragglers (mat-checkbox / bare inputs not inside a form-field or radio group).
    for (const control of sectionEl.querySelectorAll(CONTROL_SELECTOR)) {
      if (control.closest(SECTION_SELECTOR) !== sectionEl) continue;
      if (counted.has(control)) continue;
      if (control.closest('mat-form-field') || control.closest('mat-radio-group')) continue;
      fields.push(buildField(findQuestionText(control), detectFieldType(control), control, sectionTitle));
    }

    return fields;
  }

  // Fallback section typing (used only when no adapter is supplied). Element-based.
  function defaultSectionType(sectionEl) {
    const t = (sectionEl && sectionEl.innerText) || '';
    if (t.includes('How did the client present') || t.includes('Who was present') || t.includes('significant changes')) return 'DailyLog';
    if (t.includes('Behavior:') && t.includes('Evidenced By:')) return 'BehaviorReduction';
    if (t.includes('Goal Implementation:') && t.includes('medical barriers')) return 'GoalImplementation';
    return 'Other';
  }

  // ABA Matrix cards have no title; kept for platforms that do.
  function getSectionTitle(sectionEl) {
    const titleSel = 'mat-card-title, [class*="card-title"], mat-panel-title, [class*="panel-title"]';
    const el = sectionEl.querySelector(titleSel);
    return (el && el.closest(SECTION_SELECTOR) === sectionEl) ? text(el) : '';
  }

  function scan(adapter) {
    let sectionEls = [];
    if (adapter && typeof adapter.detectSections === 'function') {
      try { sectionEls = adapter.detectSections() || []; } catch (e) { sectionEls = []; }
    }
    let sections = Array.from(sectionEls);
    if (!sections.length) sections = Array.from(document.querySelectorAll(SECTION_SELECTOR));

    const getType = function (el) {
      if (adapter && typeof adapter.getSectionType === 'function') {
        try { return adapter.getSectionType(el) || 'Other'; } catch (e) { return defaultSectionType(el); }
      }
      return defaultSectionType(el);
    };

    const outSections = [];
    const seen = new Set();
    for (const el of sections) {
      if (seen.has(el)) continue;
      seen.add(el);
      const title = getSectionTitle(el);
      const fields = extractFields(el, title);
      // Drop empty/wrapper cards; a real section always has fields.
      if (fields.length > 0) {
        outSections.push({ title: title, type: getType(el), fields: fields });
      }
    }

    return {
      platform: (adapter && adapter.platform) || 'unknown',
      url: location.href,
      scannedAt: new Date().toISOString(),
      sections: outSections
    };
  }

  window.FormEngineScanner = { scan: scan };
})();
