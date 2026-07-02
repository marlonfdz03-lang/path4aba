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
      el.focus();
      // Use native setter to bypass Angular's value tracking
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(el, value);
      } else {
        el.value = value;
      }
      // Dispatch events Angular listens to
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

    async function selectMatOption(selectEl, value) {
      if (!selectEl || !value) return;
      selectEl.click();
      await waitMs(500);
      const options = document.querySelectorAll('mat-option');
      if (!options.length) {
        // Close by pressing Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await waitMs(200);
        return;
      }

      const valueLower = value.toLowerCase().trim();

      // Try exact match first
      let match = Array.from(options).find(opt =>
        opt.innerText?.trim().toLowerCase() === valueLower
      );

      // Try contains match
      if (!match) {
        match = Array.from(options).find(opt =>
          opt.innerText?.trim().toLowerCase().includes(valueLower) ||
          valueLower.includes(opt.innerText?.trim().toLowerCase())
        );
      }

      // Try word-by-word match
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
        // Close without selecting using Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      await waitMs(400);

      // Safety close — click body to dismiss any remaining overlay
      document.body.click();
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
      // First 2 are the real ones, last 2 are duplicates from second form section
      if (index < 2 && addButtons[index]) addButtons[index].click();
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

          // Add behavior questions
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

          // Add skill questions
          skills.forEach((s, i) => {
            const name = s.name || s;
            questions.push(`Goal Implementation #${i+1} - Goal name: ${name}`);
            questions.push(`Goal Implementation #${i+1} - What medical barriers will be alleviated?`);
            questions.push(`Goal Implementation #${i+1} - What activities were used for implementation?`);
            questions.push(`Goal Implementation #${i+1} - What was the teaching procedure used?`);
            questions.push(`Goal Implementation #${i+1} - Did you use any prompts? (Yes or No)`);
            questions.push(`Goal Implementation #${i+1} - What reinforcers were used?`);
            questions.push(`Goal Implementation #${i+1} - What was the schedule of reinforcement used?`);
          });

          // Route the AI call through the background service worker (Bearer token, CORS-exempt).
          // A direct content-script fetch to path4aba.app is CORS-blocked from the abamatrix origin.
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

        // Step 2: Fill radio buttons (before adding behavior/goal sections)
        clickRadioByGroupIndex(0, 'No'); // Significant changes → No
        clickRadioByGroupIndex(1, 'No'); // Incidents → No
        clickRadioByGroupIndex(2, 'No'); // Medical concerns → No
        await waitMs(300);

        // Fill Who Was Present (caregiver chip input)
        const caregiverInput = document.querySelector('input[placeholder="Caregiver(s)"]');
        if (caregiverInput && noteData.caregivers?.length) {
          // Check if caregiver already exists as a chip
          const existingChips = document.querySelectorAll('mat-chip');
          const existingNames = Array.from(existingChips).map(c => c.textContent?.trim().replace('cancel', '').trim());

          for (const name of noteData.caregivers) {
            if (existingNames.some(n => n.includes(name.split(' ')[0]))) continue; // Skip if already added
            setMatInput(caregiverInput, name);
            await waitMs(200);
            caregiverInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await waitMs(300);
          }
        }

        // Step 3: Fill Daily Log textareas by exact index
        // textarea 0 = How did client present at START
        // textarea 1 = How did client present at END
        // textarea 2 = end session (duplicate section)
        // textarea 3 = participation
        const textareas = document.querySelectorAll('textarea');
        setMatInput(textareas[0], answers['0'] || 'The client presented as cooperative and ready to engage in structured activities.');
        setMatInput(textareas[1], answers['2'] || 'The client demonstrated appropriate disengagement and responded to closing routines.');
        setMatInput(textareas[2], answers['2'] || 'The client demonstrated appropriate disengagement and responded to closing routines.');
        setMatInput(textareas[3], answers['4'] || 'The client demonstrated active participation throughout the session with consistent engagement across targeted activities.');

        // Fill Evidenced by (input fields)
        const inputs = document.querySelectorAll('input.mat-input-element');
        setMatInput(inputs[1], answers['1'] || 'Verbal responses, eye contact, and engagement with materials.');
        await waitMs(300);

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

        // Step 6: Fill behavior fields
        // Per behavior (11 fields each):
        // mat-select = Behavior name (dropdown from assessment)
        // textarea = Evidenced By
        // mat-select = Function (Attention/Escape/Tangible/Automatic)
        // textarea = Antecedent
        // radio Yes = Antecedent Interventions
        // chip input = Interventions
        // mat-select = Main focus
        // textarea = Result
        // radio No = STO information
        const updatedTextareas = document.querySelectorAll('textarea');
        const updatedInputs = document.querySelectorAll('input.mat-input-element, input[class*="mat-chip"]');
        // Use ALL mat-selects — ABA Matrix does not duplicate these
        const matSelects = Array.from(document.querySelectorAll('mat-select'));

        const functionMap = {
          'attention': 'Attention',
          'escape': 'Escape',
          'tangible': 'Tangible',
          'automatic': 'Automatic',
          'sensory': 'Automatic',
        };

        let qIdx = 7;
        for (let i = 0; i < behaviors.length; i++) {
          const tBase = 4 + (i * 3);
          const selectBase = i * 3;
          const interventionInput = updatedInputs[2 + i];

          // Behavior name → mat-select (dropdown has client's behaviors from assessment)
          const behaviorName = behaviors[i].name || behaviors[i];
          await selectMatOption(matSelects[selectBase], behaviorName);

          // Evidenced By → textarea (tBase)
          setMatInput(updatedTextareas[tBase], answers[String(qIdx + 1)] || '');
          await waitMs(200);

          // Function → mat-select (selectBase + 1)
          const functionAnswer = (answers[String(qIdx + 2)] || '').toLowerCase();
          const functionKey = Object.keys(functionMap).find(k => functionAnswer.includes(k)) || 'escape';
          await selectMatOption(matSelects[selectBase + 1], functionMap[functionKey]);

          // Antecedent → textarea (tBase + 1)
          setMatInput(updatedTextareas[tBase + 1], answers[String(qIdx + 3)] || '');
          await waitMs(200);

          // Antecedent Interventions → Yes radio
          clickRadioByGroupIndex(3 + (i * 3), 'Yes');
          await waitMs(200);

          // Antecedent Interventions chip (appears after clicking Yes)
          await waitMs(500); // Wait for chip input to appear
          const antecedentChips = document.querySelectorAll('input[placeholder*="Antecedent"], input[class*="mat-chip"][id*="antecedent"]');
          // Re-query all chip inputs after Yes is clicked
          const allChipsNow = document.querySelectorAll('input[class*="mat-chip-list-input"]');
          // Antecedent interventions chip is at index 2 + i (one per behavior)
          const antecedentChip = allChipsNow[2 + i];
          if (antecedentChip) {
            setMatInput(antecedentChip, answers[String(qIdx + 4)] || 'Antecedent strategies implemented to prevent recurrence.');
            await waitMs(200);
            antecedentChip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await waitMs(200);
          }

          // Interventions chip
          if (interventionInput) {
            setMatInput(interventionInput, answers[String(qIdx + 5)] || '');
            await waitMs(200);
            interventionInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          }
          await waitMs(200);

          // Main focus → mat-select (selectBase + 2)
          await selectMatOption(matSelects[selectBase + 2], answers[String(qIdx + 6)] || '');
          await waitMs(800); // Extra wait for Angular to settle after dropdown

          // Result → textarea (tBase + 2) — fill twice to overcome Angular re-render
          const resultText = answers[String(qIdx + 7)] || '';
          setMatInput(updatedTextareas[tBase + 2], resultText);
          await waitMs(500);
          // Re-query and fill again in case Angular cleared it
          const freshTextareas = document.querySelectorAll('textarea');
          setMatInput(freshTextareas[tBase + 2], resultText);
          await waitMs(300);

          qIdx += 8;
          await waitMs(400);
        }

        // Step 7: Fill goal fields
        let gIdx = 7 + (behaviors.length * 8);
        const goalSelectBase = behaviors.length * 3;
        for (let i = 0; i < skills.length; i++) {
          const chipBase = 7 + (i * 3);

          // Goal name → mat-select (from assessment dropdown)
          await selectMatOption(matSelects[goalSelectBase + i], skills[i].name || skills[i]);
          await waitMs(500);

          // Medical barriers chip
          if (updatedInputs[chipBase]) {
            setMatInput(updatedInputs[chipBase], answers[String(gIdx + 1)] || '');
            await waitMs(200);
            updatedInputs[chipBase].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await waitMs(200);
          }

          // Activities chip
          if (updatedInputs[chipBase + 1]) {
            setMatInput(updatedInputs[chipBase + 1], answers[String(gIdx + 2)] || '');
            await waitMs(200);
            updatedInputs[chipBase + 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await waitMs(200);
          }

          // Teaching procedure → mat-select
          const teachingSelectIdx = goalSelectBase + skills.length + i;
          await selectMatOption(matSelects[teachingSelectIdx], answers[String(gIdx + 3)] || '');
          await waitMs(400);

          // Prompts radio → Yes
          clickRadioByGroupIndex(3 + (behaviors.length * 3) + (i * 2), 'Yes');
          await waitMs(200);

          // Reinforcers chip
          if (updatedInputs[chipBase + 2]) {
            setMatInput(updatedInputs[chipBase + 2], answers[String(gIdx + 5)] || '');
            await waitMs(200);
            updatedInputs[chipBase + 2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await waitMs(200);
          }

          gIdx += 7;
          await waitMs(400);
        }

        // Step 8: Leave Relevant Information / Comments EMPTY
        // (The full note should NOT go here)

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
