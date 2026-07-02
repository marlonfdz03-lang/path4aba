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

  async function runFormAgent(noteData) {
    noteData = noteData || {};

    // ── Phase 2: ClinicalExtractor — ONE AI call, before any scanning ──
    const clinicalFacts = await extractClinicalFacts(noteData);
    console.log('[Path4ABA] ClinicalFacts:', clinicalFacts);
    window.__p4ClinicalFacts = clinicalFacts; // stored for Phase 3 (Planner)

    // ── Continue to scan ──
    // Scanner/Normalizer run in the MAIN world. If they're reachable from this context, run
    // them and store the NormalizedForm; otherwise the scan is produced by the MAIN-world
    // engine (run window.debugFormEngine() in the page) and wired to the orchestrator in
    // Phase 3. Either way Phase 2 only STORES facts — nothing is filled.
    let normalizedForm = null;
    if (window.FormEngineScanner && window.FormEngineNormalizer) {
      const adapter = window.ABAMatrixAdapter || null;
      const raw = window.FormEngineScanner.scan(adapter);
      normalizedForm = window.FormEngineNormalizer.normalize(raw, adapter);
      window.__p4NormalizedForm = normalizedForm;
      console.log('[Path4ABA] NormalizedForm (Phase 1 scan):', normalizedForm);
    } else {
      console.log('[Path4ABA] Scan engine not in this world — run window.debugFormEngine() in the page (MAIN world). Facts stored; Planner is Phase 3.');
    }

    return { clinicalFacts: clinicalFacts, normalizedForm: normalizedForm };
  }

  window.runFormAgent = runFormAgent;
})();
