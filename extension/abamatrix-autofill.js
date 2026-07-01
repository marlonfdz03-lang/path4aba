// ABA Matrix Autofill — Path4ABA Integration
// Detects when user is on app.abamatrix.com/session and fills the form

if (window.__abaMatrixLoaded) {
  // Already injected (declared content script removed — now injected on demand via
  // chrome.scripting.executeScript). Guard prevents stacking a second onMessage
  // listener, which would fill the form twice on the next click.
} else {
  window.__abaMatrixLoaded = true;

  function fillABAMatrix(noteData) {
    // Helper to set Angular Material input value
    function setMatInput(el, value) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Helper to click radio button (Yes/No)
    function clickRadio(groupName, value) {
      const radios = document.querySelectorAll(`input[name="${groupName}"]`);
      radios.forEach(r => {
        const label = r.closest('mat-radio-button')?.querySelector('.mat-radio-label-content')?.textContent?.trim();
        if (label === value) r.click();
      });
    }

    // Helper to click a radio group by index
    function clickRadioByIndex(index, value) {
      const groups = document.querySelectorAll('mat-radio-group');
      if (groups[index]) {
        const buttons = groups[index].querySelectorAll('mat-radio-button');
        buttons.forEach(btn => {
          if (btn.textContent?.trim() === value) btn.querySelector('input')?.click();
        });
      }
    }

    // Helper to fill textarea by index
    function fillTextarea(index, value) {
      const textareas = document.querySelectorAll('textarea');
      if (textareas[index]) setMatInput(textareas[index], value);
    }

    // Helper to click add button (+ for behavior/goal)
    function clickAddButton(index) {
      const addButtons = document.querySelectorAll('.add-event-button');
      if (addButtons[index]) addButtons[index].click();
    }

    // Helper to set CKEditor rich text
    function setCKEditor(value) {
      const editor = document.querySelector('.ck-editor__editable');
      if (editor) {
        editor.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, value);
      }
    }

    // Wait for dynamic elements to appear
    function waitForElement(selector, callback, timeout = 3000) {
      const start = Date.now();
      const check = () => {
        const el = document.querySelector(selector);
        if (el) { callback(el); return; }
        if (Date.now() - start < timeout) setTimeout(check, 100);
      };
      check();
    }

    // ── FILL DAILY LOG ──────────────────────────────────────────────────────

    // Significant changes to environment → No
    clickRadioByIndex(0, 'No');

    // Who was present → already set by ABA Matrix from session data

    // How did client present at START
    fillTextarea(3, noteData.clientPresentStart || 'The client presented as cooperative and ready to engage in structured activities.');

    // Evidenced by (start)
    const inputs = document.querySelectorAll('input.mat-input-element');
    if (inputs[0]) setMatInput(inputs[0], noteData.evidentStart || 'Verbal responses, eye contact, and engagement with materials.');

    // How did client present at END
    fillTextarea(5, noteData.clientPresentEnd || 'The client demonstrated appropriate disengagement and responded to closing routines.');

    // Evidenced by (end)
    fillTextarea(6, noteData.evidentEnd || 'Compliance with clean-up routine and appropriate farewell behavior.');

    // Client participation
    fillTextarea(7, noteData.participation || 'The client demonstrated active participation throughout the session with consistent engagement across targeted activities.');

    // Incidents → No
    clickRadioByIndex(1, 'No');

    // Medical concerns → No
    clickRadioByIndex(2, 'No');

    // Relevant Information / Comments → paste full note
    setTimeout(() => {
      setCKEditor(noteData.fullNote || '');
    }, 500);

    // ── FILL BEHAVIOR REDUCTION ─────────────────────────────────────────────
    async function fillBehaviorReduction(behaviors) {
      for (let i = 0; i < behaviors.length; i++) {
        const behavior = behaviors[i];
        // Click + button for Behavior Reduction
        clickAddButton(0);
        await new Promise(r => setTimeout(r, 800));

        // After clicking +, new fields appear — fill them
        const allTextareas = document.querySelectorAll('textarea');
        const allInputs = document.querySelectorAll('input.mat-input-element');

        // These indices shift after each + click — use last added section
        // Behavior name field. Accept both { name } objects and plain name strings.
        const behaviorFields = document.querySelectorAll('[placeholder*="behavior"], [placeholder*="Behavior"]');
        const behaviorName = behavior.name || behavior;
        if (behaviorFields[i]) setMatInput(behaviorFields[i], behaviorName);

        await new Promise(r => setTimeout(r, 300));
      }
    }

    // ── FILL GOAL IMPLEMENTATION ────────────────────────────────────────────
    async function fillGoalImplementation(skills) {
      for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        clickAddButton(1);
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // Run behavior and goal filling
    if (noteData.behaviors?.length) fillBehaviorReduction(noteData.behaviors);
    setTimeout(() => {
      if (noteData.skills?.length) fillGoalImplementation(noteData.skills);
    }, noteData.behaviors?.length * 1000 + 1000);
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
