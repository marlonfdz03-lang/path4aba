if (window.__abaMatrixLoaded) {
  // Already injected — just update the listener, don't re-run fill
} else {
  window.__abaMatrixLoaded = true;
  window.__abaMatrixFilling = false;

  function fillABAMatrix(noteData) {
    const API_BASE = 'https://path4aba.app';

    function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

    function setMatInput(el, value) {
      if (!el) return;
      el.focus();
      el.value = '';
      document.execCommand('insertText', false, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      el.blur();
    }

    function clickRadioByGroupIndex(groupIndex, value) {
      const groups = document.querySelectorAll('mat-radio-group');
      if (!groups[groupIndex]) return;
      groups[groupIndex].querySelectorAll('mat-radio-button').forEach(btn => {
        if (btn.textContent?.trim() === value) btn.querySelector('input')?.click();
      });
    }

    function clickAddButton(index) {
      const addButtons = document.querySelectorAll('.add-event-button');
      if (addButtons[index]) addButtons[index].click();
    }

    async function doFill() {
      if (window.__abaMatrixFilling) return;
      window.__abaMatrixFilling = true;

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
            questions.push(`Behavior Reduction #${i+1} - Antecedent Interventions used (Yes or No)?`);
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

        // Step 3: Fill Daily Log textareas by exact index
        // textarea 0 = How did client present at START
        // textarea 1 = How did client present at END
        // textarea 2 = end session (duplicate section)
        // textarea 3 = participation
        const textareas = document.querySelectorAll('textarea');
        setMatInput(textareas[0], answers['0'] || 'The client presented as cooperative and ready to engage in structured activities.');
        setMatInput(textareas[1], answers['2'] || 'The client demonstrated appropriate disengagement and responded to closing routines.');
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

        // Step 6: Fill behavior fields after all sections are created
        // After behaviors are added, textareas shift:
        // For each behavior section (5 textareas each): Evidenced By, textarea1, textarea2...
        // Based on DOM map:
        // textarea 4 = Behavior #1 Evidenced By
        // textarea 5 = Behavior #1 field1
        // textarea 6 = Behavior #1 field2
        // textarea 7 = Behavior #2 Evidenced By
        // etc.
        const updatedTextareas = document.querySelectorAll('textarea');
        const updatedInputs = document.querySelectorAll('input.mat-input-element');

        let qIdx = 7; // behaviors start at question index 7
        for (let i = 0; i < behaviors.length; i++) {
          const baseTextarea = 4 + (i * 3);
          const baseInput = 2 + i; // mat-chip-list-input for interventions

          // Evidenced By
          setMatInput(updatedTextareas[baseTextarea], answers[String(qIdx + 1)] || '');
          // Function fields (textarea)
          setMatInput(updatedTextareas[baseTextarea + 1], answers[String(qIdx + 2)] || '');
          setMatInput(updatedTextareas[baseTextarea + 2], answers[String(qIdx + 3)] || '');
          // Antecedent interventions radio → Yes
          clickRadioByGroupIndex(3 + (i * 3), 'Yes');
          // Interventions chip input
          setMatInput(updatedInputs[baseInput], answers[String(qIdx + 5)] || '');
          await waitMs(200);
          updatedInputs[baseInput]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

          qIdx += 8;
          await waitMs(300);
        }

        // Step 7: Fill goal fields
        let gIdx = 7 + (behaviors.length * 8);
        for (let i = 0; i < skills.length; i++) {
          const baseGoalTextarea = 19 + (i * 2);
          setMatInput(updatedTextareas[baseGoalTextarea], answers[String(gIdx)] || (skills[i].name || skills[i]));
          setMatInput(updatedTextareas[baseGoalTextarea + 1], answers[String(gIdx + 1)] || '');
          // Prompts radio → Yes
          clickRadioByGroupIndex(3 + (behaviors.length * 3) + (i * 2), 'Yes');
          gIdx += 7;
          await waitMs(300);
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
