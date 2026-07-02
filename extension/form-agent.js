/**
 * Path4ABA Form Engine — Form Agent (Phase 2 orchestrator)
 *
 * runFormAgent(noteData) is the single entry point for the beta engine. Phase 2 wires the
 * ClinicalExtractor: it extracts structured ClinicalFacts from the session note ONCE (before
 * any scanning), stores them, and logs them for verification. The Planner (Phase 3) is not
 * implemented yet — facts are just stored for the next phase; nothing is filled.
 *
 * WORLD / CORS: the extract-facts AI call is routed through background.js (Bearer token,
 * CORS-exempt via host_permissions). A direct fetch from a content script to path4aba.app is
 * CORS-blocked from the app.abamatrix.com origin (proxy.ts does not allowlist it), and
 * MAIN-world scripts can't reach chrome.storage for the token — so, exactly like
 * getABAMatrixAnswers, the call goes through the background service worker. This module
 * therefore runs in the ISOLATED world (it needs chrome.runtime).
 *
 * Exposes: window.runFormAgent(noteData) -> Promise<{ clinicalFacts, normalizedForm }>
 */
(function () {
  'use strict';
  // Always overwrite on (re)injection — no idempotency guard (matches the engine modules).
  window.__FormEngine_v = (window.__FormEngine_v || 0) + 1;

  // Progress helper — surfaces to the popup's status div (and the console). The background has
  // an agentStatus listener, so there's always a receiver (no "no receiver" rejection).
  function sendStatus(text, level) {
    console.log('[Path4ABA]', text);
    try { chrome.runtime.sendMessage({ action: 'agentStatus', text: text, level: level || 'info' }); } catch (e) { /* noop */ }
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Extract ClinicalFacts once per session via the background proxy (Bearer, CORS-exempt).
  function extractClinicalFacts(noteData) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(
        {
          action: 'getClinicalFacts',
          note: noteData.fullNote || noteData.note || '',
          behaviors: (noteData.behaviors || []).map(function (b) { return b && b.name ? b.name : b; }),
          skills: (noteData.skills || []).map(function (s) { return s && s.name ? s.name : s; }),
          caregivers: noteData.caregivers || [],
          clientName: noteData.clientName || 'the client'
        },
        function (response) {
          if (chrome.runtime.lastError) {
            console.error('[Path4ABA] getClinicalFacts error:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          if (response && response.error) {
            console.error('[Path4ABA] extract-facts error:', response.error);
          }
          resolve((response && response.facts) || null);
        }
      );
    });
  }

  // Expand the form (add one Behavior/Goal section per fact) in the MAIN world, before scanning.
  function expandFormSections(behaviorsCount, skillsCount) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(
        { action: 'expandFormSections', behaviorsCount: behaviorsCount, skillsCount: skillsCount },
        function (response) {
          if (chrome.runtime.lastError) {
            console.error('[Path4ABA] expandFormSections error:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          if (response && response.error) console.error('[Path4ABA] expandFormSections error:', response.error);
          resolve((response && response.expanded) || null);
        }
      );
    });
  }

  // Get the NormalizedForm. The scan runs in the MAIN world (the engine's world) via the
  // background bridge, so this ISOLATED module receives the plain object back.
  function getFormSchema() {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ action: 'getFormSchema' }, function (response) {
        if (chrome.runtime.lastError) {
          console.error('[Path4ABA] getFormSchema error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        if (response && response.error) console.error('[Path4ABA] getFormSchema error:', response.error);
        resolve((response && response.normalizedForm) || null);
      });
    });
  }

  // Get the FillPlan from the Planner endpoint (via the background proxy).
  function getPlanFill(facts, normalizedForm) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(
        { action: 'getPlanFill', facts: facts, normalizedForm: normalizedForm },
        function (response) {
          if (chrome.runtime.lastError) {
            console.error('[Path4ABA] getPlanFill error:', chrome.runtime.lastError.message);
            resolve([]);
            return;
          }
          if (response && response.error) console.error('[Path4ABA] getPlanFill error:', response.error);
          resolve((response && response.plan) || []);
        }
      );
    });
  }

  // Execute the FillPlan in the MAIN world (the Executor's world) via the background bridge.
  function executeFillPlan(plan) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ action: 'executeFillPlan', plan: plan }, function (response) {
        if (chrome.runtime.lastError) {
          console.error('[Path4ABA] executeFillPlan error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        if (response && response.error) console.error('[Path4ABA] executeFillPlan error:', response.error);
        resolve((response && response.results) || null);
      });
    });
  }

  async function runFormAgent(noteData) {
    noteData = noteData || {};

    // ── Phase 2: ClinicalExtractor — ONE AI call, before any scanning ──
    sendStatus('🧠 Extracting clinical facts from the note…');
    const clinicalFacts = await extractClinicalFacts(noteData);
    console.log('[Path4ABA] ClinicalFacts:', clinicalFacts);
    window.__p4ClinicalFacts = clinicalFacts; // stored for Phase 3 (Planner)
    if (!clinicalFacts) {
      sendStatus('⚠️ Fact extraction failed — see console.');
      return { clinicalFacts: null, normalizedForm: null };
    }
    const nB = (clinicalFacts.behaviors || []).length;
    const nS = (clinicalFacts.skills || []).length;
    sendStatus('✅ Clinical facts extracted (' + nB + ' behaviors, ' + nS + ' skills).');

    // ── Expand the form: add a Behavior/Goal section per fact BEFORE scanning ──
    sendStatus('➕ Expanding form sections…');
    await expandFormSections(nB, nS);
    sendStatus('Form expanded: ' + nB + ' behaviors, ' + nS + ' goals', 'info');

    // Give Angular time to finish rendering all the new mat-cards before scanning.
    await wait(2000);

    // ── Phase 3a: NormalizedForm via the MAIN-world scan (background bridge) ──
    sendStatus('🔍 Scanning the form…');
    const normalizedForm = await getFormSchema();
    window.__p4NormalizedForm = normalizedForm;
    console.log('[Path4ABA] NormalizedForm:', normalizedForm);
    if (!normalizedForm) {
      sendStatus('⚠️ Form scan failed — see console.');
      return { clinicalFacts: clinicalFacts, normalizedForm: null, plan: null };
    }
    const nFields = (normalizedForm.sections || []).reduce(function (n, s) { return n + (s.fields || []).length; }, 0);
    sendStatus('✅ Form scanned (' + nFields + ' fields).');

    // ── Phase 3b: Planner — facts + NormalizedForm -> FillPlan ──
    sendStatus('🗺️ Planning fill actions…');
    const plan = await getPlanFill(clinicalFacts, normalizedForm);
    window.__p4FillPlan = plan; // stored for Phase 4 (Executor)
    console.log('[Path4ABA] FillPlan:', plan);
    sendStatus('Plan created: ' + (plan ? plan.length : 0) + ' actions', 'info');

    // ── Phase 4: Executor — fill the form from the plan (runs in the MAIN world) ──
    if (!plan || plan.length === 0) {
      sendStatus('No fill actions to execute.', 'warning');
      return { clinicalFacts: clinicalFacts, normalizedForm: normalizedForm, plan: plan, results: null };
    }
    sendStatus('✍️ Filling ' + plan.length + ' fields…');
    const results = await executeFillPlan(plan);
    console.log('[Path4ABA] Executor results:', results);
    if (results) {
      sendStatus(
        'Filled ' + results.filled + ' fields, ' + results.skipped + ' skipped, ' + results.failed + ' failed',
        results.filled > 0 ? 'success' : 'warning'
      );
    } else {
      sendStatus('⚠️ Executor failed — see console.', 'warning');
    }
    return { clinicalFacts: clinicalFacts, normalizedForm: normalizedForm, plan: plan, results: results };
  }

  window.runFormAgent = runFormAgent;
})();
