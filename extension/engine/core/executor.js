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
  resolveLocator(locator, sectionEl, fieldType) {
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

    const el = this.resolveLocator(fieldData.locator, sectionEl, action.fieldType);
    if (!el) {
      console.warn('[Path4ABA Executor] DOM element not found for:', action.fieldId, fieldData.questionText);
      return false;
    }

    switch (action.fieldType) {
      case 'textarea':
      case 'input':
      case 'text':
        window.setMatInput(el, action.value);
        return true;

      case 'select':
        await window.selectMatOption(el, action.value);
        return true;

      case 'radio': {
        const group = el.closest('mat-radio-group') || el;
        const buttons = group.querySelectorAll('mat-radio-button');
        for (const btn of buttons) {
          if (btn.innerText?.trim() === action.value) {
            btn.click();
            await this.wait(600);
            return true;
          }
        }
        console.warn('[Path4ABA Executor] Radio option not found:', action.value);
        return false;
      }

      case 'chip':
        window.setMatInput(el, action.value);
        await this.wait(150);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;

      default:
        return false;
    }
  },

  wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
};
