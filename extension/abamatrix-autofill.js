// ABA Matrix Autofill — Path4ABA Integration
// Detects when user is on app.abamatrix.com/session and fills the form

if (window.__abaMatrixLoaded) {
  // Already injected (declared content script removed — now injected on demand via
  // chrome.scripting.executeScript). Guard prevents stacking a second onMessage
  // listener, which would fill the form twice on the next click.
} else {
  window.__abaMatrixLoaded = true;

  function fillABAMatrix(noteData) {
    const API_BASE = 'https://path4aba.app';

    // Helper to set Angular Material input/textarea value
    function setMatInput(el, value) {
      el.focus();
      el.value = '';
      document.execCommand('insertText', false, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      el.blur();
    }

    // Helper to click radio Yes/No by group index
    function clickRadioByGroupIndex(groupIndex, value) {
      const groups = document.querySelectorAll('mat-radio-group');
      if (groups[groupIndex]) {
        const buttons = groups[groupIndex].querySelectorAll('mat-radio-button');
        buttons.forEach(btn => {
          if (btn.textContent?.trim() === value) btn.querySelector('input')?.click();
        });
      }
    }

    // Helper to click + button
    function clickAddButton(index) {
      const addButtons = document.querySelectorAll('.add-event-button');
      if (addButtons[index]) addButtons[index].click();
    }

    // Helper to wait for element
    function waitMs(ms) {
      return new Promise(r => setTimeout(r, ms));
    }

    // Extract all questions from the form dynamically
    function extractQuestions() {
      const questions = [];
      const questionDivs = document.querySelectorAll('mat-card, .session-form, [class*="form-field"], mat-form-field');

      // Get all visible text labels that look like questions
      const allText = document.querySelectorAll('div, span, label, p');
      allText.forEach(el => {
        const text = el.innerText?.trim();
        if (text && text.endsWith('?') && text.length > 10 && text.length < 200) {
          if (!questions.includes(text)) questions.push(text);
        }
      });
      return questions;
    }

    // Main fill function
    async function doFill() {
      // Step 1: Extract questions from the form
      const questions = extractQuestions();
      console.log('[Path4ABA] Found questions:', questions);

      // Step 2: Get AI answers from Path4ABA API
      let answers = {};
      try {
        answers = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'getABAMatrixAnswers', note: noteData.fullNote, questions },
            (response) => resolve(response?.answers || {})
          );
        });
        console.log('[Path4ABA] AI answers:', answers);
      } catch (err) {
        console.error('[Path4ABA] Failed to get AI answers:', err);
        return;
      }

      // Step 3: Fill radio buttons
      clickRadioByGroupIndex(0, 'No'); // Significant changes → No
      clickRadioByGroupIndex(1, 'No'); // Incidents → No
      clickRadioByGroupIndex(2, 'No'); // Medical concerns → No

      await waitMs(300);

      // Step 4: Fill textareas with AI answers
      // Map question text to textarea
      const textareas = document.querySelectorAll('textarea');
      const questionMap = {
        'How did the client present at the start of the session?': answers[2] || answers['2'] || 'The client presented as cooperative and engaged.',
        'How did the client present at the end of the session?': answers[3] || answers['3'] || 'The client demonstrated appropriate disengagement.',
        "How was the client's participation during service?": answers[4] || answers['4'] || 'The client demonstrated active participation throughout the session.',
      };

      // Fill textareas by finding nearest question label
      textareas.forEach(textarea => {
        let label = '';
        let el = textarea;
        for (let j = 0; j < 10; j++) {
          el = el.parentElement;
          if (!el) break;
          const text = el.innerText?.trim().split('\n')[0];
          if (text && text.length > 10) { label = text; break; }
        }
        if (questionMap[label]) setMatInput(textarea, questionMap[label]);
      });

      // Step 5: Fill Behavior Reduction sections
      const behaviors = noteData.behaviors || [];
      for (let i = 0; i < behaviors.length; i++) {
        clickAddButton(0);
        await waitMs(1000);
      }

      // Step 6: Fill Goal Implementation sections
      const skills = noteData.skills || [];
      for (let i = 0; i < skills.length; i++) {
        clickAddButton(1);
        await waitMs(1000);
      }

      // Step 7: Fill Relevant Information with summary only (not full note)
      await waitMs(500);
      const ckEditor = document.querySelector('.ck-editor__editable');
      if (ckEditor) {
        ckEditor.focus();
        document.execCommand('selectAll', false, null);
        const summary = answers['summary'] || `Session addressed behavior reduction and skill acquisition goals per the treatment plan. ${answers[5] || ''}`;
        document.execCommand('insertText', false, summary);
      }

      console.log('[Path4ABA] ABA Matrix form filled successfully');
    }

    doFill();
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fillABAMatrix') {
      fillABAMatrix(message.data);
      sendResponse({ ok: true });
    }
  });

  // Notify popup that we're on ABA Matrix
  if (window.location.href.includes('app.abamatrix.com/session')) {
    chrome.runtime.sendMessage({ action: 'onABAMatrix' });
  }
}
