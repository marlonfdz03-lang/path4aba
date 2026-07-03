/**
 * Path4ABA Form Engine — Executor (Phase 4, runs in the MAIN world)
 *
 * Fills form fields from a FillPlan. It locates each field's section by sectionId (DL /
 * BR{n} / Goal{n}), finds the DOM control near the field's questionText, and drives it with
 * the MAIN-world window.setMatInput / window.selectMatOption helpers (mat-helpers.js).
 *
 * Depends on: window.setMatInput, window.selectMatOption (mat-helpers.js),
 *             window.ABAMatrixAdapter (adapter), window.__p4NormalizedForm (fieldIndex).
 * Executes ONLY the plan it is handed — it does not plan.
 */
window.__FormEngine_v = (window.__FormEngine_v || 0) + 1;

window.FormEngineExecutor = {
  async execute(plan) {
    const results = { filled: 0, skipped: 0, failed: 0 };

    if (!window.setMatInput || !window.selectMatOption) {
      console.error('[Path4ABA Executor] setMatInput/selectMatOption not available — is mat-helpers.js loaded?');
      return results;
    }

    for (const action of plan) {
      try {
        const success = await this.fillField(action);
        if (success) results.filled++;
        else results.skipped++;
      } catch (err) {
        console.error('[Path4ABA Executor] Failed:', action.fieldId, err.message);
        results.failed++;
      }
      await this.wait(300);
    }

    console.log('[Path4ABA Executor] Done:', results);
    return results;
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

  async fillField(action) {
    const norm = window.__p4NormalizedForm;
    if (!norm?.fieldIndex) {
      console.warn('[Path4ABA Executor] NormalizedForm not available');
      return false;
    }

    const fieldData = norm.fieldIndex[action.fieldId];
    if (!fieldData) {
      console.warn('[Path4ABA Executor] Field not in index:', action.fieldId);
      return false;
    }

    const sectionEl = this.getSectionElement(action.sectionId);
    if (!sectionEl) {
      console.warn('[Path4ABA Executor] Section not found:', action.sectionId);
      return false;
    }

    const resolvedEl = this.resolveLocator(fieldData.locator, sectionEl, action.fieldType, action.fieldId);
    // Chips can be conditional (they render after a "Yes" radio) — let them retry below
    // instead of failing here. All other types require the element up front.
    if (!resolvedEl && action.fieldType !== 'chip') {
      console.warn('[Path4ABA Executor] DOM element not found for:', action.fieldId, fieldData.questionText);
      return false;
    }

    switch (action.fieldType) {
      case 'textarea':
      case 'input':
      case 'text':
        window.setMatInput(resolvedEl, action.value);
        return true;

      case 'select':
        await window.selectMatOption(resolvedEl, action.value);
        return true;

      case 'radio': {
        const group = resolvedEl.closest('mat-radio-group') || resolvedEl;
        const buttons = group.querySelectorAll('mat-radio-button');
        for (const btn of buttons) {
          if (btn.innerText?.trim() === action.value) {
            btn.click();
            // Wait for Angular to render any conditional field this choice reveals
            // (e.g. the AntecedentInterventions chip that appears after "Yes").
            await this.wait(1200);
            return true;
          }
        }
        console.warn('[Path4ABA Executor] Radio option not found:', action.value);
        return false;
      }

      case 'chip': {
        let el = resolvedEl;
        if (!el) {
          // Retry once after a delay — a conditional chip may appear after a radio click.
          await this.wait(500);
          el = this.resolveLocator(fieldData.locator, sectionEl, action.fieldType, action.fieldId);
        }
        if (!el) {
          console.warn('[Path4ABA Executor] Chip not found (after retry):', action.fieldId, fieldData.questionText);
          return false;
        }
        window.setMatInput(el, action.value);
        await this.wait(150);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      }

      default:
        return false;
    }
  },

  wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
};
