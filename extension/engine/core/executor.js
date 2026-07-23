/**
 * Path4ABA Form Engine — Executor (Phase 4, runs in the MAIN world)
 *
 * Fills form fields from a FillPlan. It locates each field's section by sectionId (DL /
 * BR{n} / Goal{n}), finds the DOM control near the field's questionText, and drives it with a
 * SUPERSET write path: Angular Ivy's __ngContext__ accessor (guarded) PLUS DOM events
 * (input/change/blur) that flip ng-dirty/ng-touched. ABA Matrix is Angular (Material + CDK),
 * NOT React — so no _valueTracker. Selects use the CDK overlay via window.selectMatOption
 * (mat-helpers.js).
 *
 * Depends on: window.selectMatOption (mat-helpers.js),
 *             window.ABAMatrixAdapter (adapter), window.__p4NormalizedForm (fieldIndex).
 * Executes ONLY the plan it is handed — it does not plan.
 */
window.__FormEngine_v = (window.__FormEngine_v || 0) + 1;

window.FormEngineExecutor = {
  // New diagnostics gated behind this flag (default false); no field VALUES are ever logged.
  // A property (NOT a top-level `const`) so re-injecting this file stays safe (no redeclare).
  DEBUG: false,

  async execute(plan) {
    // needsReview[]: fields we deliberately did NOT write (unknown/blank) or could not fill.
    // verifications[]: per-field fillAndVerify results (intended vs actual).
    const results = { filled: 0, skipped: 0, failed: 0, needsReview: [], verifications: [], validation: null };

    if (!window.selectMatOption) {
      console.error('[Path4ABA Executor] selectMatOption not available — is mat-helpers.js loaded?');
      return results;
    }

    for (const action of plan) {
      try {
        const outcome = await this.fillField(action);
        if (outcome.status === 'filled') results.filled++;
        else if (outcome.status === 'skipped') results.skipped++;
        else results.failed++;
        if (outcome.review) results.needsReview.push(outcome.review);
        if (outcome.verification) results.verifications.push(outcome.verification);
      } catch (err) {
        console.error('[Path4ABA Executor] Failed:', action.fieldId, err.message);
        results.failed++;
        results.needsReview.push({ stableId: action.fieldId, label: action.fieldId, reason: 'NEEDS_REVIEW' });
      }
      await this.wait(300);
    }

    // Rule 6: read the host app's own validation state AFTER the fill completes.
    try {
      const adapter = window.ABAMatrixAdapter;
      if (adapter && typeof adapter.readValidationState === 'function') {
        results.validation = adapter.readValidationState();
      }
    } catch (err) {
      if (this.DEBUG) console.warn('[Path4ABA Executor] readValidationState failed:', err.message);
    }

    if (this.DEBUG) console.log('[Path4ABA Executor] Done:', {
      filled: results.filled, skipped: results.skipped, failed: results.failed,
      needsReview: results.needsReview.length,
    });
    return results;
  },

  // ── Value helpers ──────────────────────────────────────────────────────────
  isBlank(v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  },

  // Rule 3: a planned value we must never write (skip the field entirely instead).
  isSkippable(v) {
    return this.isBlank(v) || v === 'unknown';
  },

  valuesMatch(actual, intended) {
    const a = String(actual == null ? '' : actual).trim().toLowerCase();
    const b = String(intended == null ? '' : intended).trim().toLowerCase();
    if (!a) return false;
    return a === b || a.includes(b) || b.includes(a);
  },

  // ── Rule 3: classify the target by STRUCTURE (never by label / field / section name) ──
  detectStrategy(el, action) {
    if (el && el.isContentEditable) return 'contenteditable';
    const tag = ((el && el.tagName) || '').toLowerCase();
    if (tag === 'mat-select' || (el && el.closest && el.closest('mat-select'))) return 'select';
    if (tag === 'mat-radio-group' || tag === 'mat-radio-button') return 'radio';
    if (tag === 'textarea') return 'text';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'radio') return 'radio';
      const cls = el.className || '';
      if (/mat-chip/i.test(cls) || (el.closest && el.closest('mat-chip-list, mat-chip-grid, mat-chip-list-input'))) return 'chip';
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (role === 'combobox' || el.getAttribute('aria-autocomplete') || el.hasAttribute('matautocomplete') || el.getAttribute('aria-haspopup') === 'listbox') return 'autocomplete';
      return 'text';
    }
    // Fall back to the scanner's structural classification.
    if (action && action.fieldType === 'select') return 'select';
    if (action && action.fieldType === 'radio') return 'radio';
    if (action && action.fieldType === 'chip') return 'chip';
    return 'text';
  },

  // ── Rule 1: the SINGLE Angular-safe write path for ALL text field writes ──────
  // ABA Matrix is Angular (Material + CDK), NOT React. This is a SUPERSET of two mechanisms,
  // both required:
  //   • __ngContext__ accessor (Angular Ivy's internal element context) — the path that was
  //     already filling 77/83 fields. Guarded so it's a no-op (never throws) when absent.
  //   • DOM events (input/change/blur) — what actually flips ng-dirty / ng-touched, fixing the
  //     6 fields the accessor alone left ng-pristine.
  // (_valueTracker is intentionally NOT used — that one is genuinely React-only.)
  setAngularValue(el, value) {
    if (!el) return;
    const v = value == null ? '' : String(value);

    el.focus();
    if (typeof el.click === 'function') el.click();
    el.value = v;

    // Angular Ivy accessor (guarded — no-op when __ngContext__ is absent, e.g. some prod builds).
    const ctx = el.__ngContext__;
    if (ctx && Array.isArray(ctx)) {
      for (let i = 0; i < ctx.length; i++) {
        const item = ctx[i];
        if (item && typeof item === 'object' && typeof item.onChange === 'function' && item._elementRef) {
          item.onChange(v);
          if (typeof item.onTouched === 'function') item.onTouched();
          break;
        }
      }
    }

    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, data: v, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    if (typeof el.blur === 'function') el.blur();
  },

  // Rule 2 retry fallback: simulate a real keystroke for the FINAL character so Angular's
  // input pipeline definitely fires when a bulk value-set did not stick (ng-dirty stayed false).
  keyboardCommit(el, value) {
    if (!el) return;
    const v = value == null ? '' : String(value);
    const last = v.length ? v.slice(-1) : ' ';
    const head = v.length ? v.slice(0, -1) : '';
    el.focus();
    if (typeof el.click === 'function') el.click();
    el.value = head;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, data: head, inputType: 'insertText' }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: last, bubbles: true }));
    el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: last, inputType: 'insertText' }));
    el.value = v;

    // Mirror setAngularValue's Ivy accessor (guarded) so the fallback isn't strictly weaker than
    // the path it rescues. Same position: after the value is set, before the events.
    const ctx = el.__ngContext__;
    if (ctx && Array.isArray(ctx)) {
      for (let i = 0; i < ctx.length; i++) {
        const item = ctx[i];
        if (item && typeof item === 'object' && typeof item.onChange === 'function' && item._elementRef) {
          item.onChange(v);
          if (typeof item.onTouched === 'function') item.onTouched();
          break;
        }
      }
    }

    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, data: last, inputType: 'insertText' }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: last, bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    if (typeof el.blur === 'function') el.blur();
  },

  // Rule 2: read Angular's control state from the ng-* classes — the GROUND TRUTH the host
  // app's validator uses. Re-reading el.value proves nothing (it always echoes what we wrote).
  // Resolves the ng-* host: the element itself, or the nearest descendant/ancestor carrying it.
  verifyAngularState(el) {
    const carries = (n) => !!(n && n.classList && (
      n.classList.contains('ng-pristine') || n.classList.contains('ng-dirty') ||
      n.classList.contains('ng-valid') || n.classList.contains('ng-invalid')));
    let node = el;
    if (!carries(node) && el) {
      const desc = el.querySelector && el.querySelector('.ng-dirty, .ng-pristine, .ng-valid, .ng-invalid');
      if (desc) node = desc;
      else {
        let p = el.parentElement, hops = 0;
        while (p && hops < 4 && !carries(p)) { p = p.parentElement; hops++; }
        if (carries(p)) node = p;
      }
    }
    const cl = (node && node.classList) || { contains: () => false };
    return {
      dirty: cl.contains('ng-dirty'),
      touched: cl.contains('ng-touched'),
      pristine: cl.contains('ng-pristine'),
      valid: cl.contains('ng-valid'),
      invalid: cl.contains('ng-invalid'),
    };
  },

  isRequired(el) {
    if (!el) return false;
    return !!(el.required || (el.getAttribute && el.getAttribute('aria-required') === 'true'));
  },

  // Re-read a field's current DISPLAYED value/selection (used only for value-mismatch checks).
  readBack(el, strategy) {
    if (!el) return '';
    if (strategy === 'select') {
      const sel = el.matches?.('mat-select') ? el : (el.closest?.('mat-select') || el);
      const node = sel.querySelector?.('.mat-select-value-text, .mat-mdc-select-value-text, .mat-select-value');
      return node ? (node.innerText || '').trim() : '';
    }
    if (strategy === 'radio') {
      const group = el.closest?.('mat-radio-group') || el;
      const checked = group.querySelector?.('mat-radio-button.mat-radio-checked, mat-radio-button.mat-mdc-radio-checked');
      return checked ? (checked.innerText || '').trim() : '';
    }
    if (strategy === 'chip') {
      // After Enter the chip input is cleared and the value lives in a chip token — look there.
      const scope = el.closest?.('mat-form-field, mat-chip-list, mat-chip-grid') || el.parentElement;
      const chips = scope ? scope.querySelectorAll('mat-chip, mat-chip-row, .mat-chip, .mat-mdc-chip') : [];
      for (const c of chips) { const t = (c.innerText || '').trim(); if (t) return t; }
      return el.value || '';
    }
    if (strategy === 'contenteditable') return (el.textContent || '').trim();
    return ('value' in el ? el.value : '') || '';
  },

  // Rule 2: score a field against Angular state. For text-like writes the GROUND TRUTH is
  // ng-dirty (the whole point of this fix). For radio/select/chip a positive selection/token
  // OR ng-dirty counts — so currently-working actuations are never falsely flagged.
  scoreField(el, action, label, strategy) {
    const state = this.verifyAngularState(el);
    const actual = this.readBack(el, strategy);
    const required = this.isRequired(el);
    const valueOk = this.valuesMatch(actual, action.value);

    let ok, reason;
    if (strategy === 'text' || strategy === 'autocomplete' || strategy === 'contenteditable') {
      if (!state.dirty && !(strategy === 'contenteditable' && valueOk)) { ok = false; reason = 'NOT_DIRTY'; }
      else if (required && state.invalid) { ok = false; reason = 'INVALID'; }
      else if (!valueOk) { ok = false; reason = 'VALUE_MISMATCH'; }
      else { ok = true; reason = null; }
    } else {
      if (state.dirty || valueOk) {
        ok = !(required && state.invalid);
        reason = ok ? null : 'INVALID';
      } else { ok = false; reason = 'NOT_DIRTY'; }
    }
    return {
      stableId: action.fieldId, label, intended: action.value, actual,
      dirty: state.dirty, touched: state.touched, valid: state.valid, ok, reason,
    };
  },

  // Rule 2: write a text field the Angular-safe way, wait for change detection, verify against
  // ng-dirty, and retry ONCE via keyboard simulation if it did not stick.
  async fillAndVerify(el, action, label, strategy) {
    const strat = strategy || 'text';
    this.setAngularValue(el, action.value);
    await this.wait(80);
    let v = this.scoreField(el, action, label, strat);
    if (!v.dirty) {
      if (this.DEBUG) console.log('[Path4ABA Executor] not dirty — keyboard retry:', action.fieldId);
      this.keyboardCommit(el, action.value);
      await this.wait(80);
      v = this.scoreField(el, action, label, strat);
    }
    return v;
  },

  // contenteditable targets: set textContent + beforeinput/input, then blur.
  async fillContentEditable(el, action, label) {
    const v = action.value == null ? '' : String(action.value);
    el.focus();
    el.textContent = v;
    el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: v, inputType: 'insertText' }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, data: v, inputType: 'insertText' }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    if (typeof el.blur === 'function') el.blur();
    await this.wait(80);
    return this.scoreField(el, action, label, 'contenteditable');
  },

  // mat-autocomplete / combobox: after typing, click the exact-text overlay option if present,
  // otherwise commit the typed value with blur.
  async commitAutocomplete(el, action) {
    await this.wait(300);
    const want = String(action.value == null ? '' : action.value).trim().toLowerCase();
    const options = Array.from(document.querySelectorAll('.cdk-overlay-container mat-option, mat-option'));
    const match = options.find((o) => (o.innerText || '').trim().toLowerCase() === want);
    if (match) { match.click(); await this.wait(200); }
    else { el.dispatchEvent(new FocusEvent('blur', { bubbles: true })); if (typeof el.blur === 'function') el.blur(); }
  },

  // Package a filled field's verification into an execute() outcome.
  outcomeFrom(verification, action, label) {
    const review = verification && !verification.ok
      ? { stableId: action.fieldId, label, reason: verification.reason || 'NEEDS_REVIEW' }
      : undefined;
    return { status: 'filled', verification, review };
  },

  getSectionElement(sectionId) {
    const sections = window.ABAMatrixAdapter.detectSections();

    if (sectionId === 'DL') {
      const dlSection = sections.find(s => s.type === 'DailyLog');
      return dlSection ? dlSection.element : null;
    }

    if (sectionId.startsWith('BR')) {
      const n = parseInt(sectionId.replace('BR', ''), 10) - 1;
      const brSections = sections.filter(s => s.type === 'BehaviorReduction');
      return brSections[n] ? brSections[n].element : null;
    }

    if (sectionId.startsWith('Goal')) {
      const n = parseInt(sectionId.replace('Goal', ''), 10) - 1;
      const goalSections = sections.filter(s => s.type === 'GoalImplementation');
      return goalSections[n] ? goalSections[n].element : null;
    }

    return null;
  },

  // Resolve a field's DOM element from the locator the SCANNER saved — no re-discovery.
  // Chips resolve by placeholder / chip-index; everything else falls back to proximity.
  resolveLocator(locator, sectionEl, fieldType, fieldId = '') {
    if (!locator) return null;

    switch (locator.strategy) {
      case 'placeholder': {
        const els = Array.isArray(sectionEl) ? sectionEl : [sectionEl];
        for (const el of els) {
          const found = el.querySelector(`input[placeholder="${locator.placeholder}"]`);
          if (found) return found;
        }
        return null;
      }
      case 'chip-index': {
        const els = Array.isArray(sectionEl) ? sectionEl : [sectionEl];
        for (const el of els) {
          const chips = Array.from(el.querySelectorAll('input[class*="mat-chip-input"]'))
            .filter(c => !c.placeholder || c.placeholder === '');
          if (chips[locator.chipIndex]) return chips[locator.chipIndex];
        }
        return null;
      }
      case 'label-search': {
        const sel =
          fieldType === 'select' ? 'mat-select' :
          fieldType === 'chip' ? 'input[class*="mat-chip-input"]' :
          'textarea, input.mat-input-element';
        // Fields whose id ends in "2" (e.g. DL_EvidencedBy2) are the SECOND matching instance.
        const isSecondInstance = (fieldId || '').endsWith('2');
        const els = Array.isArray(sectionEl) ? sectionEl : [sectionEl];
        const matches = [];
        const seenEls = new Set();
        for (const el of els) {
          const labels = el.querySelectorAll('mat-label, label, strong, b, p, div');
          for (const label of labels) {
            if (label.innerText?.trim().toLowerCase().includes(locator.searchText.toLowerCase())) {
              // Try each candidate container; collect the field it holds. Dedupe by element,
              // since nested divs match the same field repeatedly.
              for (const ff of [label.nextElementSibling, label.closest('mat-form-field'), label.parentElement?.nextElementSibling, label.closest('div')]) {
                if (!ff) continue;
                const field = ff.querySelector(sel);
                if (field && !seenEls.has(field)) { seenEls.add(field); matches.push(field); break; }
              }
            }
          }
        }
        return matches[isSecondInstance ? 1 : 0] || matches[0] || null;
      }
      case 'proximity':
      default:
        return this.findFieldElement(sectionEl, locator.questionText, fieldType);
    }
  },

  findFieldElement(sectionEl, questionText, fieldType) {
    const selector =
      fieldType === 'select' ? 'mat-select' :
      fieldType === 'radio' ? 'mat-radio-group' :
      fieldType === 'chip' ? 'input[class*="mat-chip-input"]' :
      'textarea, input.mat-input-element';

    const elements = Array.isArray(sectionEl) ? sectionEl : [sectionEl];
    const searchText = questionText.toLowerCase().slice(0, 30);

    // Special case: EvidencedBy textareas — the label is often a plain <p>/<strong>/<div>
    // (not a mat-label), so mirror the legacy findFieldByLabel search (closest form-field/div).
    if (questionText.toLowerCase().includes('evidenced')) {
      const allLabels = Array.isArray(sectionEl)
        ? sectionEl.flatMap(f => Array.from(f.querySelectorAll('mat-label, label, strong, b, p, div')))
        : Array.from(sectionEl.querySelectorAll('mat-label, label, strong, b, p, div'));

      for (const label of allLabels) {
        if (label.innerText?.trim().toLowerCase().includes('evidenced')) {
          const formField = label.closest('mat-form-field') || label.closest('div');
          if (formField) {
            const ta = formField.querySelector('textarea');
            if (ta) return ta;
          }
        }
      }
    }

    for (const el of elements) {
      const labels = el.querySelectorAll('mat-label, strong, p, b, div.text-bold, div[class*="header"]');
      for (const label of labels) {
        if (label.innerText?.trim().toLowerCase().includes(searchText)) {
          // Search nearby: next siblings and parent next sibling
          const candidates = [
            label.nextElementSibling,
            label.parentElement?.nextElementSibling,
            label.closest('mat-form-field'),
            label.parentElement?.parentElement?.nextElementSibling
          ];
          for (const candidate of candidates) {
            if (!candidate) continue;
            const field = candidate.matches?.(selector) ? candidate : candidate.querySelector(selector);
            if (field) return field;
          }
        }
      }
    }

    // Chip inputs have no nearby label (they live inside mat-chip-list containers), so the
    // proximity search above misses them. Special-case chips.
    if (fieldType === 'chip') {
      // For Daily Log chips: sectionEl is an ARRAY of forms outside mat-card.
      if (Array.isArray(sectionEl)) {
        for (const form of sectionEl) {
          const chips = form.querySelectorAll('input[class*="mat-chip-input"]');
          for (const chip of chips) {
            const nearby = chip.closest('mat-form-field') || chip.parentElement?.parentElement;
            const labelText = nearby?.querySelector('mat-label, strong, p')?.innerText?.trim() || '';
            if (labelText.toLowerCase().includes(questionText.toLowerCase().slice(0, 20))) {
              return chip;
            }
          }
        }
        // Fallback: return first chip in Daily Log forms
        for (const form of sectionEl) {
          const chip = form.querySelector('input[class*="mat-chip-input"]');
          if (chip) return chip;
        }
      } else {
        // For BR/Goal sections: search all chip inputs in the section
        const chips = sectionEl.querySelectorAll('input[class*="mat-chip-input"]');
        for (const chip of chips) {
          const nearby = chip.closest('mat-form-field') || chip.parentElement?.parentElement;
          const prevText = nearby?.previousElementSibling?.innerText?.trim() ||
                           chip.parentElement?.parentElement?.previousElementSibling?.innerText?.trim() || '';
          if (prevText.toLowerCase().includes(questionText.toLowerCase().slice(0, 20))) {
            return chip;
          }
        }
        // Last resort: return first unfilled chip in section
        for (const chip of chips) {
          if (!chip.value) return chip;
        }
      }
    }

    return null;
  },

  // Returns an outcome object: { status: 'filled'|'skipped'|'failed', review?, verification? }.
  async fillField(action) {
    const norm = window.__p4NormalizedForm;
    if (!norm?.fieldIndex) {
      if (this.DEBUG) console.warn('[Path4ABA Executor] NormalizedForm not available');
      return { status: 'failed', review: { stableId: action.fieldId, label: action.fieldId, reason: 'NEEDS_REVIEW' } };
    }

    const fieldData = norm.fieldIndex[action.fieldId];
    const label = (fieldData && fieldData.questionText) || action.fieldId;
    if (!fieldData) {
      if (this.DEBUG) console.warn('[Path4ABA Executor] Field not in index:', action.fieldId);
      return { status: 'skipped', review: { stableId: action.fieldId, label, reason: 'NEEDS_REVIEW' } };
    }

    // Rule 5: never write a guess. Skip unknown/null/empty entirely — no click, no clearing.
    if (this.isSkippable(action.value)) {
      return { status: 'skipped', review: { stableId: action.fieldId, label, reason: 'NEEDS_REVIEW' } };
    }

    const sectionEl = this.getSectionElement(action.sectionId);
    if (!sectionEl) {
      if (this.DEBUG) console.warn('[Path4ABA Executor] Section not found:', action.sectionId);
      return { status: 'failed', review: { stableId: action.fieldId, label, reason: 'NEEDS_REVIEW' } };
    }

    let resolvedEl = this.resolveLocator(fieldData.locator, sectionEl, action.fieldType, action.fieldId);
    // Chips can be conditional (rendered after a "Yes" radio) — retry once before failing.
    if (!resolvedEl && action.fieldType !== 'chip') {
      if (this.DEBUG) console.warn('[Path4ABA Executor] DOM element not found for:', action.fieldId, label);
      return { status: 'failed', review: { stableId: action.fieldId, label, reason: 'NEEDS_REVIEW' } };
    }
    if (!resolvedEl && action.fieldType === 'chip') {
      await this.wait(500);
      resolvedEl = this.resolveLocator(fieldData.locator, sectionEl, action.fieldType, action.fieldId);
      if (!resolvedEl) {
        if (this.DEBUG) console.warn('[Path4ABA Executor] Chip not found (after retry):', action.fieldId, label);
        return { status: 'failed', review: { stableId: action.fieldId, label, reason: 'NEEDS_REVIEW' } };
      }
    }

    // Rule 3: choose the actuation strategy from the resolved element's STRUCTURE.
    const strategy = this.detectStrategy(resolvedEl, action);
    if (this.DEBUG) console.log('[Path4ABA Executor] strategy:', action.fieldId, '->', strategy);

    switch (strategy) {
      case 'text': {
        const verification = await this.fillAndVerify(resolvedEl, action, label, 'text');
        return this.outcomeFrom(verification, action, label);
      }

      case 'autocomplete': {
        this.setAngularValue(resolvedEl, action.value);
        await this.commitAutocomplete(resolvedEl, action);
        await this.wait(80);
        let verification = this.scoreField(resolvedEl, action, label, 'autocomplete');
        if (!verification.dirty && !verification.ok) {
          this.keyboardCommit(resolvedEl, action.value);
          await this.wait(80);
          verification = this.scoreField(resolvedEl, action, label, 'autocomplete');
        }
        return this.outcomeFrom(verification, action, label);
      }

      case 'contenteditable': {
        const verification = await this.fillContentEditable(resolvedEl, action, label);
        return this.outcomeFrom(verification, action, label);
      }

      case 'select': {
        // mat-select has no native <select> — selectMatOption clicks the CDK overlay option.
        await window.selectMatOption(resolvedEl, action.value);
        await this.wait(80);
        const verification = this.scoreField(resolvedEl, action, label, 'select');
        return this.outcomeFrom(verification, action, label);
      }

      case 'radio': {
        const group = resolvedEl.closest('mat-radio-group') || resolvedEl;
        const buttons = group.querySelectorAll('mat-radio-button');
        for (const btn of buttons) {
          if (btn.innerText?.trim() === action.value) {
            // Rule 3: click the associated input / label — never set checked = true.
            const input = btn.querySelector('input[type="radio"]') || btn.querySelector('input');
            const labelEl = btn.querySelector('label');
            if (input) input.click();
            else if (labelEl) labelEl.click();
            else btn.click();
            // Wait for Angular to render any conditional field this choice reveals
            // (e.g. the AntecedentInterventions chip that appears after "Yes").
            await this.wait(1200);
            const verification = this.scoreField(group, action, label, 'radio');
            return this.outcomeFrom(verification, action, label);
          }
        }
        if (this.DEBUG) console.warn('[Path4ABA Executor] Radio option not found:', action.value);
        return { status: 'failed', review: { stableId: action.fieldId, label, reason: 'NEEDS_REVIEW' } };
      }

      case 'chip': {
        this.setAngularValue(resolvedEl, action.value);
        await this.wait(150);
        resolvedEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await this.wait(80);
        const verification = this.scoreField(resolvedEl, action, label, 'chip');
        return this.outcomeFrom(verification, action, label);
      }

      default:
        return { status: 'failed', review: { stableId: action.fieldId, label, reason: 'NEEDS_REVIEW' } };
    }
  },

  wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
};
