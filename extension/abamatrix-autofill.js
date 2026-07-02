if (window.__abaMatrixLoaded) {
  // Already injected — just update the listener, don't re-run fill
} else {
  window.__abaMatrixLoaded = true;
  window.__abaMatrixFilling = false;
  window.__abaMatrixLastFill = 0;

  function fillABAMatrix(noteData) {
    const API_BASE = 'https://path4aba.app';

    function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

    function setMatInput(el, value) {
      if (!el) return;
      // Try Angular's onChange accessor first (most reliable for Angular Material)
      const ctx = el.__ngContext__;
      if (ctx && Array.isArray(ctx)) {
        for (let i = 0; i < ctx.length; i++) {
          const item = ctx[i];
          if (item && typeof item === 'object' && typeof item.onChange === 'function' && item._elementRef) {
            el.value = value;
            item.onChange(value);
            if (typeof item.onTouched === 'function') item.onTouched();
            return;
          }
        }
      }
      // Fallback: native setter + events
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    async function selectMatOption(selectEl, value) {
      if (!selectEl || !value) return;
      selectEl.click();
      await waitMs(500);
      const options = document.querySelectorAll('mat-option');
      if (!options.length) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await waitMs(200);
        return;
      }

      const valueLower = value.toLowerCase().trim();

      let match = Array.from(options).find(opt =>
        opt.innerText?.trim().toLowerCase() === valueLower
      );
      if (!match) {
        match = Array.from(options).find(opt =>
          opt.innerText?.trim().toLowerCase().includes(valueLower) ||
          valueLower.includes(opt.innerText?.trim().toLowerCase())
        );
      }
      if (!match) {
        const words = valueLower.split(' ').filter(w => w.length > 3);
        match = Array.from(options).find(opt => {
          const optLower = opt.innerText?.trim().toLowerCase();
          return words.length > 0 && words.every(w => optLower.includes(w));
        });
      }

      if (match) {
        match.click();
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      await waitMs(400);

      // Close the dropdown — focus select then send Escape
      selectEl.focus();
      selectEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      await waitMs(150);
      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      if (backdrop) {
        backdrop.click();
      } else {
        document.documentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
      await waitMs(200);
    }

    function clickRadioByGroupIndex(groupIndex, value) {
      const groups = document.querySelectorAll('mat-radio-group');
      if (!groups[groupIndex]) return;
      groups[groupIndex].querySelectorAll('mat-radio-button').forEach(btn => {
        if (btn.textContent?.trim() === value) btn.querySelector('input')?.click();
      });
    }

    function clickAddButton(index) {
      // ABA Matrix has duplicate add buttons — use only first 2 (behavior and goal)
      const addButtons = document.querySelectorAll('.add-event-button');
      if (index < 2 && addButtons[index]) addButtons[index].click();
    }

    // ── Label-based field detection helpers (new architecture) ──────────────────

    async function waitForElement(selector, parent = document, timeout = 4000) {
      return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          const el = parent.querySelector(selector);
          if (el && el.offsetParent !== null) { resolve(el); return; }
          if (Date.now() - start > timeout) { resolve(null); return; }
          requestAnimationFrame(check);
        };
        check();
      });
    }

    async function findFieldByLabel(labelText, parent = document) {
      // Find a field (input, textarea, mat-select) near a label containing labelText
      const allLabels = parent.querySelectorAll('mat-label, label, .mat-form-field-label, strong, b, p');
      for (const label of allLabels) {
        if (label.innerText?.trim().toLowerCase().includes(labelText.toLowerCase())) {
          const formField = label.closest('mat-form-field') || label.closest('div');
          if (formField) {
            const field = formField.querySelector('textarea, input:not([type="radio"]):not([type="checkbox"]), mat-select');
            if (field) return field;
          }
        }
      }
      return null;
    }

    async function fillSection(sectionEl, fields) {
      // fields = array of { label, value, type: 'text'|'select'|'radio'|'chip' }
      for (const field of fields) {
        if (field.type === 'radio') {
          const radios = sectionEl.querySelectorAll('mat-radio-button, input[type="radio"]');
          for (const radio of radios) {
            if (radio.innerText?.trim() === field.value || radio.value === field.value) {
              radio.click();
              await waitMs(300);
              break;
            }
          }
          continue;
        }
        const el = await waitForElement(
          field.type === 'select' ? 'mat-select' :
          field.type === 'chip' ? 'input[class*="mat-chip"]' : 'textarea, input.mat-input-element',
          sectionEl,
          3000
        );
        if (!el) continue;
        if (field.type === 'select') {
          await selectMatOption(el, field.value);
        } else if (field.type === 'chip') {
          setMatInput(el, field.value);
          await waitMs(150);
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        } else {
          setMatInput(el, field.value);
        }
        await waitMs(200);
      }
    }

    // Click the first "Yes" radio button within a card (card-scoped, label-based).
    function clickYesRadioInCard(card) {
      const yesBtn = Array.from(card.querySelectorAll('mat-radio-button'))
        .find(r => r.textContent?.trim() === 'Yes');
      yesBtn?.querySelector('input')?.click();
    }

    // Fill + submit a chip input (Enter to commit the chip).
    async function fillChip(chipEl, value) {
      if (!chipEl) return;
      setMatInput(chipEl, value);
      await waitMs(150);
      chipEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await waitMs(200);
    }

    async function doFill() {
      const now = Date.now();
      if (window.__abaMatrixLastFill && (now - window.__abaMatrixLastFill) < 3000) {
        console.log('[Path4ABA] Fill debounced, skipping duplicate within 3s');
        return;
      }
      window.__abaMatrixLastFill = now;

      try {
        const behaviors = noteData.behaviors || [];
        const skills = noteData.skills || [];
        const note = noteData.fullNote || '';

        // Step 1: Get AI answers
        let answers = {};
        try {
          const questions = [
            'How did the client present at the start of the session?',
            'Evidenced by (start of session):',
            'How did the client present at the end of the session?',
            'Evidenced by (end of session):',
            "How was the client's participation during service?",
            'Were there any incidents during the service?',
            'Were there any medical concerns?',
          ];

          behaviors.forEach((b, i) => {
            const name = b.name || b;
            questions.push(`Behavior Reduction #${i+1} - Behavior name: ${name}`);
            questions.push(`Behavior Reduction #${i+1} - Evidenced By (observable description):`);
            questions.push(`Behavior Reduction #${i+1} - What was the function of the behavior?`);
            questions.push(`Behavior Reduction #${i+1} - What prompted the behavior? (Antecedent)`);
            questions.push(`Behavior Reduction #${i+1} - What antecedent interventions were implemented to prevent the behavior?`);
            questions.push(`Behavior Reduction #${i+1} - After the behavior, what interventions were implemented?`);
            questions.push(`Behavior Reduction #${i+1} - What was the main focus of the applied interventions?`);
            questions.push(`Behavior Reduction #${i+1} - What was the result of the implemented interventions?`);
          });

          skills.forEach((s, i) => {
            const name = s.name || s;
            questions.push(`Goal Implementation #${i+1} - Goal name: ${name}`);
            questions.push(`Goal Implementation #${i+1} - What medical barriers will be alleviated?`);
            questions.push(`Goal Implementation #${i+1} - What activities were used for implementation?`);
            questions.push(`Goal Implementation #${i+1} - What was the teaching procedure used?`);
            questions.push(`Goal Implementation #${i+1} - Did you use any prompts? (Yes or No)`);
            questions.push(`Goal Implementation #${i+1} - What reinforcers were used?`);
            questions.push(`Goal Implementation #${i+1} - What schedule of reinforcement was used? Select ONLY from these exact options based on what's described in the note:
Continuous Reinforcement, Fixed Ratio (FR) Schedule, Variable Ratio (VR) Schedule, Fixed Interval (FI) Schedule, Variable Interval (VI) Schedule, Fixed Time (FT) Schedule, Variable Time (VT) Schedule, DRO (Differential Reinforcement of Other Behavior), DRA (Differential Reinforcement of Alternative Behavior), DRI (Differential Reinforcement of Incompatible Behavior), DRL (Differential Reinforcement of Low Rates), DRH (Differential Reinforcement of High Rates), Multiple Schedule, Mixed Schedule, Concurrent Schedule, Chained Schedule, Tandem Schedule, Conjunctive Schedule, Alternative Schedule.
If the note mentions reinforcement contingent on specific responses → Fixed Ratio (FR) Schedule.
If the note mentions reinforcement after time delays → Fixed Interval (FI) Schedule.
If the note mentions continuous praise → Continuous Reinforcement.
If not specified → Continuous Reinforcement.`);
          });

          // Route the AI call through the background service worker (Bearer token, CORS-exempt).
          answers = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { action: 'getABAMatrixAnswers', note, questions },
              (response) => resolve(response?.answers || {})
            );
          });
          console.log('[Path4ABA] AI answers received:', Object.keys(answers).length);
        } catch (err) {
          console.error('[Path4ABA] AI call failed:', err);
          return;
        }

        const functionMap = {
          'attention': 'Attention',
          'escape': 'Escape',
          'tangible': 'Tangible',
          'automatic': 'Automatic',
          'sensory': 'Automatic',
        };

        // Step 2: Fill top-level radios (before adding behavior/goal sections)
        clickRadioByGroupIndex(0, 'No'); // Significant changes → No
        clickRadioByGroupIndex(1, 'No'); // Incidents → No
        clickRadioByGroupIndex(2, 'No'); // Medical concerns → No
        await waitMs(300);

        // Step 3: Fill Who Was Present (caregiver chip input)
        const caregiverInput = document.querySelector('input[placeholder="Caregiver(s)"]');
        if (caregiverInput && noteData.caregivers?.length) {
          const existingChips = document.querySelectorAll('mat-chip');
          const existingNames = Array.from(existingChips).map(c => c.textContent?.trim().replace('cancel', '').trim());
          for (const name of noteData.caregivers) {
            if (existingNames.some(n => n.includes(name.split(' ')[0]))) continue;
            setMatInput(caregiverInput, name);
            await waitMs(200);
            caregiverInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await waitMs(300);
          }
        }

        // Step 4: Click + for each behavior
        for (let i = 0; i < behaviors.length; i++) {
          clickAddButton(0);
          await waitMs(800);
        }
        // Step 5: Click + for each skill
        for (let i = 0; i < skills.length; i++) {
          clickAddButton(1);
          await waitMs(800);
        }
        await waitMs(1000);

        // Helper: get the mat-card for behavior/goal by section order.
        // Card 0 = Daily Log; behavior cards follow; goal cards follow behaviors.
        const cardAt = (idx) => document.querySelectorAll('mat-card')[idx];

        // ── Step 6: Fill behavior fields — label-based within each behavior card ──
        // CALIBRATE: the label strings below (evidenced/function/prompted/main focus/result)
        // are best-guesses from the field semantics. Verify against ABA Matrix's real labels.
        for (let i = 0; i < behaviors.length; i++) {
          const qIdx = 7 + (i * 8);
          const card = cardAt(i + 1); // +1 skips the Daily Log card
          if (!card) continue;

          // Behavior name → mat-select
          const nameSelect = await findFieldByLabel('behavior name', card) || card.querySelector('mat-select');
          if (nameSelect) await selectMatOption(nameSelect, behaviors[i].name || behaviors[i]);

          // Evidenced By → textarea
          const evidencedField = await findFieldByLabel('evidenced', card);
          if (evidencedField) { setMatInput(evidencedField, answers[String(qIdx + 1)] || ''); await waitMs(200); }

          // Function → mat-select
          const functionAnswer = (answers[String(qIdx + 2)] || '').toLowerCase();
          const functionKey = Object.keys(functionMap).find(k => functionAnswer.includes(k)) || 'escape';
          const functionSelect = await findFieldByLabel('function', card);
          if (functionSelect) await selectMatOption(functionSelect, functionMap[functionKey]);

          // Antecedent → textarea ("What prompted the behavior?")
          const antecedentField = await findFieldByLabel('what prompted', card) || await findFieldByLabel('antecedent (', card);
          if (antecedentField) { setMatInput(antecedentField, answers[String(qIdx + 3)] || ''); await waitMs(200); }

          // Antecedent Interventions → Yes radio, then wait for the chip to appear
          clickYesRadioInCard(card);
          await waitMs(400);
          const antecedentChip = await waitForElement('input[class*="mat-chip"]', card, 3000);
          await fillChip(antecedentChip, answers[String(qIdx + 4)] || 'Visual schedule and verbal prompts.');

          // Consequence / after-behavior interventions → second chip in the card
          const behaviorChips = card.querySelectorAll('input[class*="mat-chip"]');
          await fillChip(behaviorChips[1], answers[String(qIdx + 5)] || '');

          // Main focus → mat-select
          const mainFocusSelect = await findFieldByLabel('main focus', card);
          if (mainFocusSelect) { await selectMatOption(mainFocusSelect, answers[String(qIdx + 6)] || ''); await waitMs(400); }

          // Result → textarea
          const resultField = await findFieldByLabel('result', card);
          if (resultField) { setMatInput(resultField, answers[String(qIdx + 7)] || ''); await waitMs(200); }

          await waitMs(300);
        }

        // ── Step 7: Fill goal fields — label-based within each goal card ──
        // CALIBRATE: label strings (goal/medical barrier/activit/what prompts/teaching/reinforcer/schedule).
        for (let i = 0; i < skills.length; i++) {
          const gIdx = 7 + (behaviors.length * 8) + (i * 7);
          const card = cardAt(1 + behaviors.length + i); // after Daily Log + behavior cards
          if (!card) continue;

          // Goal name → mat-select
          const goalNameSelect = await findFieldByLabel('goal', card) || card.querySelector('mat-select');
          if (goalNameSelect) { await selectMatOption(goalNameSelect, skills[i].name || skills[i]); await waitMs(300); }

          // Medical barriers → chip
          const barriersChip = await findFieldByLabel('medical barrier', card);
          await fillChip(barriersChip, answers[String(gIdx + 1)] || '');

          // Activities → chip
          const activitiesChip = await findFieldByLabel('activit', card);
          await fillChip(activitiesChip, answers[String(gIdx + 2)] || '');

          // Prompts → Yes radio, then wait for the "what prompts were used?" field
          clickYesRadioInCard(card);
          await waitMs(400);
          const promptsField = await findFieldByLabel('what prompts', card)
            || await waitForElement('textarea, input.mat-input-element', card, 3000);
          if (promptsField) { setMatInput(promptsField, answers[String(gIdx + 4)] || 'Verbal and gestural prompts.'); await waitMs(200); }

          // Teaching procedure → textarea
          const teachingField = await findFieldByLabel('teaching', card);
          if (teachingField) { setMatInput(teachingField, answers[String(gIdx + 3)] || ''); await waitMs(200); }

          // Reinforcers → chip
          const reinforcersChip = await findFieldByLabel('reinforcer', card);
          await fillChip(reinforcersChip, answers[String(gIdx + 5)] || '');

          // Schedule of reinforcement → textarea
          const scheduleField = await findFieldByLabel('schedule', card);
          if (scheduleField) { setMatInput(scheduleField, answers[String(gIdx + 6)] || 'Continuous Reinforcement'); await waitMs(200); }

          await waitMs(300);
        }

        // Force close ALL open dropdowns before filling Daily Log
        await waitMs(500);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        await waitMs(200);
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
        await waitMs(500);

        // Step 8: Fill Daily Log textareas AFTER all dropdowns to prevent Angular clearing them
        const finalTextareas = document.querySelectorAll('textarea');
        setMatInput(finalTextareas[0], answers['0'] || 'The client presented as cooperative and ready to engage in structured activities.');
        setMatInput(finalTextareas[1], answers['2'] || 'The client demonstrated appropriate disengagement and responded to closing routines.');
        setMatInput(finalTextareas[2], answers['2'] || 'The client demonstrated appropriate disengagement and responded to closing routines.');
        setMatInput(finalTextareas[3], answers['4'] || 'The client demonstrated active participation throughout the session.');

        // Fill Evidenced by start (plain text input)
        const evidencedByInput = document.getElementById('mat-input-6') ||
          document.querySelector('input.mat-input-element[id*="mat-input"]');
        if (evidencedByInput) {
          setMatInput(evidencedByInput, answers['1'] || 'Verbal responses, eye contact, and engagement with materials.');
        }

        await waitMs(500);

        // Note: Leave Relevant Information / Comments EMPTY (the full note should NOT go here)

        console.log('[Path4ABA] ABA Matrix form filled successfully');
        alert('✅ ABA Matrix form filled! Please review and adjust before submitting.');
      } finally {
        window.__abaMatrixFilling = false;
      }
    }

    doFill();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fillABAMatrix') {
      fillABAMatrix(message.data);
      sendResponse({ ok: true });
    }
  });
}
