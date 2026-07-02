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
  // Always overwrite on (re)injection — no idempotency guard — so a fresh injection
  // during calibration installs the latest code instead of keeping a stale definition.
  window.__FormEngine_v = (window.__FormEngine_v || 0) + 1;

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

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function detectFieldType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'mat-select' || tag === 'app-select') return 'select';
    if (tag === 'mat-radio-group') return 'radio';
    if (tag === 'mat-checkbox') return 'checkbox';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'mat-chip-list' || tag === 'mat-chip-grid' || tag === 'app-chip-input') return 'chip';
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

  // Question text for any field element. ABA Matrix places it in several spots:
  //   Try 1) a <mat-label> inside the field (mat-form-field)
  //   Try 2) a previous-sibling <div>/<p>/<strong> (radio groups, app-select, some inputs)
  //   Try 3) the parent's previous sibling
  // Skipping mat-radio-group / mat-chip-list / mat-chip-grid siblings prevents grabbing a
  // neighbouring field's content as this field's question.
  function getQuestionText(fieldEl) {
    // Try 1: mat-label inside the field
    const matLabel = fieldEl.querySelector('mat-label');
    if (matLabel?.innerText?.trim()) return matLabel.innerText.trim();

    // Try 2: previousElementSibling text
    let prev = fieldEl.previousElementSibling;
    let depth = 0;
    while (prev && depth < 3) {
      // Skip app-select / mat-select containers — they hold selected values, not questions.
      if (prev.matches('app-select') || prev.querySelector('mat-select')) {
        prev = prev.previousElementSibling;
        depth++;
        continue;
      }
      const text = prev.innerText?.trim();
      if (text && text.length > 3 && !prev.matches('mat-radio-group, mat-chip-list, mat-chip-grid')) {
        const firstLine = text.split('\n')[0]?.trim();
        if (firstLine && firstLine.length > 3) return firstLine;
      }
      prev = prev.previousElementSibling;
      depth++;
    }

    // Try 3: parent's previous sibling
    const parentPrev = fieldEl.parentElement?.previousElementSibling;
    if (parentPrev) {
      const text = parentPrev.innerText?.trim().split('\n')[0]?.trim();
      if (text && text.length > 3) return text;
    }

    // Try 4: extract label from parent container text, excluding app-select content.
    // (mat-form-field with no mat-label whose sibling is an <app-select> — the question is
    // in the parent's text AFTER the app-select's selected value, e.g. EvidencedBy fields.)
    const parentEl = fieldEl.parentElement;
    if (parentEl) {
      // Get all text lines in parent
      const parentText = parentEl.innerText || '';
      // Get app-select text to exclude it
      const appSelectText = parentEl.querySelector('app-select')?.innerText || '';
      // Remove app-select content from parent text
      const remainingText = parentText.replace(appSelectText, '').trim();
      // Get first meaningful line
      const lines = remainingText.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 3 && !l.match(/^(Yes|No|cancel|\d+)$/i));
      if (lines.length > 0) return lines[0];
    }

    return '';
  }

  // Resolve a chip field's actual <input> (the control may be the input or its container).
  function chipInputOf(control) {
    if (!control) return null;
    if (control.tagName === 'INPUT') return control;
    return control.querySelector('input[class*="mat-chip-input"]')
      || control.querySelector('input:not([type="hidden"])');
  }

  // A locator the Executor can resolve WITHOUT re-discovering the element by proximity:
  //   chip w/ placeholder -> { strategy:'placeholder', placeholder }
  //   chip w/o placeholder -> { strategy:'chip-index', chipIndex } (index among empty-
  //                           placeholder chip inputs in the nearest section: card or form)
  //   everything else      -> { strategy:'proximity', questionText }
  // On any chip failure (no input / not found in scope) fall back to proximity — never to a
  // misleading chipIndex 0, which would make every unmatched chip resolve to the first chip.
  function makeLocator(control, type, questionText) {
    if (type === 'chip') {
      const chipInput = chipInputOf(control);
      if (!chipInput) return { strategy: 'proximity', questionText };

      const placeholder = chipInput.placeholder || '';
      if (placeholder) {
        return { strategy: 'placeholder', placeholder };
      }

      // Calculate index among empty-placeholder chips in same mat-card or form
      const scope = chipInput.closest('mat-card') || chipInput.closest('form');
      if (scope) {
        const allEmptyChips = Array.from(scope.querySelectorAll('input[class*="mat-chip-input"]'))
          .filter(c => !c.placeholder);
        const idx = allEmptyChips.indexOf(chipInput);
        if (idx >= 0) {
          return { strategy: 'chip-index', chipIndex: idx };
        }
      }

      return { strategy: 'proximity', questionText };
    }
    return { strategy: 'proximity', questionText };
  }

  function buildField(questionText, type, control, sectionTitle) {
    return {
      questionText: questionText || '',
      fieldType: type,
      currentValue: control ? getCurrentValue(control, type) : null,
      options: control ? getOptions(control, type) : undefined,
      visible: control ? isVisible(control) : false,
      sectionTitle: sectionTitle || '',
      locator: makeLocator(control, type, questionText || '')
    };
  }

  // Field-bearing elements to look for at Daily Log (form) level, beyond mat-form-field.
  const DAILY_LOG_FIELDS = [
    'mat-radio-group', 'textarea', 'mat-select',
    'mat-chip-list', 'mat-chip-grid', 'app-select', 'app-chip-input',
    'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'
  ].join(', ');

  // Extract every field in one section.
  //   synthetic = true  -> sectionEl is the <form> (Daily Log): form-level fields, which are
  //                        often NOT wrapped in mat-form-field (bare selects/chips/etc.).
  //   synthetic = false -> sectionEl is a mat-card (Behavior/Goal): fields of THIS card only.
  // A field whose question resolved to a section header (e.g. "Behavior Reduction #1",
  // "Goal Implementation #2") is not a real field — getQuestionText grabbed the card title.
  function isSectionTitle(q) {
    return /^(behavior reduction|goal implementation)\s*#\d+/i.test(q || '');
  }

  function extractFields(sectionEl, sectionTitle, synthetic) {
    const fields = synthetic
      ? extractDailyLogFields(sectionEl, sectionTitle)
      : extractCardFields(sectionEl, sectionTitle);
    // Skip section-title elements picked up as fields.
    return fields.filter(function (f) { return !isSectionTitle(f.questionText); });
  }

  // A Behavior/Goal mat-card: include only fields belonging to THIS card (not a nested one).
  function extractCardFields(card, sectionTitle) {
    const fields = [];
    const counted = new Set();
    const inScope = function (el) { return el.closest(SECTION_SELECTOR) === card; };

    // 1) mat-form-field: getQuestionText resolves the label; inner control gives the type.
    let mffIndex = -1; // DEBUG: index among the card's mat-form-fields
    for (const ff of card.querySelectorAll('mat-form-field')) {
      mffIndex++;
      if (!inScope(ff)) {
        console.log('[SCAN] SKIPPED mat-form-field', mffIndex, 'reason:', 'out-of-scope');
        continue;
      }
      const control = controlOf(ff);
      const fieldType = control ? detectFieldType(control) : 'unknown';
      const questionText = getQuestionText(ff);
      console.log('[SCAN]', 'processing mat-form-field', mffIndex, 'fieldType=' + fieldType, 'questionText="' + questionText + '"', ff.querySelector('textarea') ? 'HAS_TEXTAREA' : 'NO_TEXTAREA');
      if (!control || !questionText) {
        console.log('[SCAN] SKIPPED mat-form-field', mffIndex, 'reason:', !control ? 'no-field-type' : 'empty-questionText');
      }
      if (control) counted.add(control);
      fields.push(buildField(questionText, fieldType, control, sectionTitle));
    }

    // 2) mat-radio-group: question comes from a previous sibling via getQuestionText.
    for (const rg of card.querySelectorAll('mat-radio-group')) {
      if (!inScope(rg)) continue;
      counted.add(rg);
      fields.push(buildField(getQuestionText(rg), 'radio', rg, sectionTitle));
    }

    // 3) Stragglers (mat-checkbox / bare inputs not inside a form-field or radio group).
    for (const control of card.querySelectorAll(CONTROL_SELECTOR)) {
      if (!inScope(control)) continue;
      if (counted.has(control)) continue;
      if (control.closest('mat-form-field') || control.closest('mat-radio-group')) continue;
      fields.push(buildField(getQuestionText(control), detectFieldType(control), control, sectionTitle));
    }

    return fields;
  }

  // Daily Log lives at <form> level (outside any mat-card). Its fields are often NOT wrapped
  // in mat-form-field — they can be bare textarea / mat-select / mat-chip-list / app-select /
  // app-chip-input / mat-radio-group. Scan mat-form-field units first, then bare form-level
  // controls, deduping controls nested inside another candidate (e.g. a mat-select inside an
  // app-select) so one logical field is not counted twice.
  function extractDailyLogFields(form, sectionTitle) {
    const fields = [];
    const seen = new Set();
    const outsideCard = function (el) { return !el.closest('mat-card'); };

    // 1) mat-form-field units at form level.
    for (const ff of form.querySelectorAll('mat-form-field')) {
      if (!outsideCard(ff)) continue;
      const control = controlOf(ff);
      const type = control ? detectFieldType(control) : 'unknown';
      if (control) seen.add(control);
      seen.add(ff);
      fields.push(buildField(getQuestionText(ff), type, control, sectionTitle));
    }

    // 2) Bare form-level field elements not wrapped in a mat-form-field.
    const candidates = Array.from(form.querySelectorAll(DAILY_LOG_FIELDS))
      .filter(function (el) { return outsideCard(el) && !el.closest('mat-form-field'); });
    const candSet = new Set(candidates);
    for (const el of candidates) {
      if (seen.has(el)) continue;
      // Keep only the outermost field element — skip a control nested inside another candidate.
      let nested = false;
      let p = el.parentElement;
      while (p && p !== form) { if (candSet.has(p)) { nested = true; break; } p = p.parentElement; }
      if (nested) continue;
      seen.add(el);
      fields.push(buildField(getQuestionText(el), detectFieldType(el), el, sectionTitle));
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
    // detectSections() returns descriptors: { element, type, title, synthetic? }.
    let descriptors = [];
    if (adapter && typeof adapter.detectSections === 'function') {
      try { descriptors = adapter.detectSections() || []; } catch (e) { descriptors = []; }
    }

    // Fallback (no adapter): treat each visible mat-card as a section descriptor.
    if (!descriptors.length) {
      descriptors = Array.from(document.querySelectorAll(SECTION_SELECTOR))
        .filter(function (el) { return el.offsetParent !== null; })
        .map(function (el) { return { element: el, type: defaultSectionType(el), title: getSectionTitle(el) }; });
    }

    const outSections = [];
    const seen = new Set();
    for (const desc of descriptors) {
      if (!desc || !desc.element) continue;

      // Daily Log: an ARRAY of single-question <form> elements, bundled into one section.
      if (desc.multiForm && Array.isArray(desc.element)) {
        const title = desc.title || 'Daily Log';
        const fields = [];
        for (const form of desc.element) {
          if (seen.has(form)) continue;
          seen.add(form);
          const formFields = extractFields(form, title, true); // synthetic -> extractDailyLogFields
          for (const f of formFields) fields.push(f);
        }
        if (fields.length > 0) {
          outSections.push({ title: title, type: desc.type || 'DailyLog', fields: fields });
        }
        continue;
      }

      const el = desc.element;
      if (seen.has(el)) continue;
      seen.add(el);
      const type = desc.type || defaultSectionType(el);
      const title = desc.title || getSectionTitle(el);
      const fields = extractFields(el, title, !!desc.synthetic);
      // Drop empty/wrapper sections; a real section always has fields.
      if (fields.length > 0) {
        outSections.push({ title: title, type: type, fields: fields });
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
