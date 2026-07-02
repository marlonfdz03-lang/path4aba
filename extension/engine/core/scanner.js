/**
 * Path4ABA Form Engine — Scanner (Phase 1)
 *
 * Walks the live DOM of a form and emits a raw, platform-agnostic FormSchema.
 * Design rules:
 *   - NO indexes in the output. A field's only locators are its questionText and
 *     its sectionTitle.
 *   - Fields are associated to questions by PROXIMITY: the mat-form-field label,
 *     then a subtree/ancestor search of preceding siblings (not nextElementSibling only).
 *   - Output is pure serializable data (no DOM node references).
 *
 * Exposes: window.FormEngineScanner.scan(adapter) -> FormSchema
 */
(function () {
  'use strict';
  if (window.FormEngineScanner) return; // idempotent — defines only, no side effects

  const SECTION_SELECTOR = 'mat-card, mat-expansion-panel';

  // One entry per logical field. Radio/checkbox GROUPS are captured (mat-radio-group,
  // mat-checkbox); their inner <input> elements are excluded to avoid double counting.
  const CONTROL_SELECTOR = [
    'mat-select',
    'mat-radio-group',
    'mat-checkbox',
    'textarea',
    'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'
  ].join(', ');

  // Label sources, strong first (real labels/headings) then weak (paragraphs/spans).
  const STRONG_LABEL = 'mat-label, label, .mat-form-field-label, strong, b, h1, h2, h3, h4, h5, h6';
  const WEAK_LABEL = 'p, span, div';

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
    // position:fixed / sticky elements report null offsetParent but may be visible.
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
      // mat-option nodes render only while the panel is open. Best-effort: read any
      // currently-open panel; otherwise options come back empty (expected when closed).
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
    // text | textarea | chip | date | number
    return ('value' in el ? el.value : '') || null;
  }

  // Pull a label from an element: strong label (self or subtree) preferred, else weak.
  function extractLabel(el) {
    if (!el) return '';
    if (el.matches && el.matches(STRONG_LABEL)) {
      const t = text(el);
      if (looksLikeQuestion(t)) return t;
    }
    const strong = el.querySelector && el.querySelector(STRONG_LABEL);
    if (strong) {
      const t = text(strong);
      if (looksLikeQuestion(t)) return t;
    }
    if (el.matches && el.matches(WEAK_LABEL)) {
      const t = text(el);
      if (looksLikeQuestion(t)) return t;
    }
    return '';
  }

  // Find a control's question by proximity: form-field label, then a climb of ancestors
  // inspecting each previous sibling (and its subtree), then aria/placeholder fallbacks.
  function findQuestionText(control) {
    // 1) Angular Material form-field label — most reliable.
    const ff = control.closest('mat-form-field');
    if (ff) {
      const lbl = ff.querySelector('mat-label, label, .mat-form-field-label');
      const t = text(lbl);
      if (looksLikeQuestion(t)) return t;
    }
    // 2) Climb ancestors; at each level scan preceding siblings (self + subtree).
    let node = control;
    for (let depth = 0; depth < 6 && node && node !== document.body; depth++) {
      let sib = node.previousElementSibling;
      let guard = 0;
      while (sib && guard++ < 8) {
        const label = extractLabel(sib);
        if (label) return label;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    // 3) Fallbacks.
    const aria = (control.getAttribute && (control.getAttribute('aria-label') || control.getAttribute('placeholder'))) || '';
    if (looksLikeQuestion(aria)) return aria.trim();
    return '';
  }

  // Section title, scoped so a nested card's title is not attributed to its parent.
  function getSectionTitle(sectionEl) {
    const titleSel = 'mat-card-title, [class*="card-title"], mat-panel-title, mat-expansion-panel-header, [class*="panel-title"], .mat-card-header-text';
    const candidates = sectionEl.querySelectorAll(titleSel);
    for (const c of candidates) {
      if (c.closest(SECTION_SELECTOR) === sectionEl) {
        const t = text(c);
        if (t) return t;
      }
    }
    const headings = sectionEl.querySelectorAll('h1, h2, h3, h4, strong, b');
    for (const h of headings) {
      if (h.closest(SECTION_SELECTOR) === sectionEl) {
        const t = text(h);
        if (t) return t;
      }
    }
    return '';
  }

  function defaultSectionType(title) {
    const t = (title || '').toLowerCase();
    if (/daily\s*log|session\s*summary|client\s*present/.test(t)) return 'DailyLog';
    if (/behavior|reduction|maladaptive/.test(t)) return 'BehaviorReduction';
    if (/goal|skill|acquisition|implementation/.test(t)) return 'GoalImplementation';
    return 'Other';
  }

  function scan(adapter) {
    // Section containers: prefer the adapter's detector, fall back to a generic query.
    let sectionEls = [];
    if (adapter && typeof adapter.detectSections === 'function') {
      try { sectionEls = adapter.detectSections() || []; } catch (e) { sectionEls = []; }
    }
    let sections = Array.from(sectionEls);
    if (!sections.length) sections = Array.from(document.querySelectorAll(SECTION_SELECTOR));

    const typeOf = (adapter && typeof adapter.getSectionType === 'function')
      ? function (title) { return adapter.getSectionType(title); }
      : defaultSectionType;

    // Build one record per section element.
    const recordByEl = new Map();
    const order = [];
    for (const el of sections) {
      if (recordByEl.has(el)) continue;
      const title = getSectionTitle(el);
      const rec = { title: title, type: typeOf(title), fields: [] };
      recordByEl.set(el, rec);
      order.push(el);
    }

    // Controls that live outside any detected section land here.
    const ungrouped = { title: '', type: 'Other', fields: [] };

    // Assign each control to its NEAREST owning section (handles nested cards cleanly).
    const controls = Array.from(document.querySelectorAll(CONTROL_SELECTOR));
    for (const control of controls) {
      const type = detectFieldType(control);
      const owner = control.closest(SECTION_SELECTOR);
      const rec = (owner && recordByEl.get(owner)) || ungrouped;
      rec.fields.push({
        questionText: findQuestionText(control),
        fieldType: type,
        currentValue: getCurrentValue(control, type),
        options: getOptions(control, type),
        visible: isVisible(control),
        sectionTitle: rec.title
      });
    }

    const outSections = order
      .map(function (el) { return recordByEl.get(el); })
      .filter(function (rec) { return rec.fields.length > 0 || rec.title; });
    if (ungrouped.fields.length) outSections.push(ungrouped);

    return {
      platform: (adapter && adapter.platform) || 'unknown',
      url: location.href,
      scannedAt: new Date().toISOString(),
      sections: outSections
    };
  }

  window.FormEngineScanner = { scan: scan };
})();
