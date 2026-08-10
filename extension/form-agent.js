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
 * MAIN-world scripts can't reach chrome.storage for the token — so the call goes through the
 * background service worker. This module therefore runs in the ISOLATED world (it needs chrome.runtime).
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
          clientName: noteData.clientName || 'the client',
          // clientId lets extract-facts fetch the assessment's approved-function set per behavior and
          // refuse to derive a function the assessment never approved for that behavior.
          clientId: noteData.clientId || null
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
    let __agentOk = true;
    try {

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
      // Buckets sum to the plan: written + repaired + skipped + failed.
      const c = results.counts || {
        written: results.filled || 0, repaired: 0, skipped: results.skipped || 0,
        failed: results.failed || 0, attempted: results.filled || 0, verified: results.filled || 0,
      };
      sendStatus(
        c.verified + ' verified, ' + c.repaired + ' repaired, ' + c.skipped + ' skipped, ' + c.failed + ' failed',
        c.failed === 0 ? 'success' : 'warning'
      );
      // Post-fill summary for the popup (Rule 7): totals + fields needing review. The needsReview
      // list combines the executor's skips/mismatches with the host app's own validation state.
      try {
        const repair = results.repair || { passes: 0, repaired: [], stillMissing: [] };
        // Fields the repair pass genuinely fixed on retry (resolved === true).
        const repairedResolved = (repair.repaired || []).filter(function (r) { return r.resolved; });
        const repairedIds = new Set(repairedResolved.map(function (r) { return r.stableId; }).filter(Boolean));

        const review = [];
        const seenReview = new Set();
        var addReview = function (item, key) {
          if (seenReview.has(key)) return;
          // A field the repair pass fixed is no longer a review item.
          if (item.stableId && repairedIds.has(item.stableId)) return;
          seenReview.add(key);
          review.push(item);
        };
        (results.needsReview || []).forEach(function (r) {
          addReview({
            stableId: r.stableId || null,
            label: r.label || r.stableId || 'field',
            reason: r.reason || 'NEEDS_REVIEW',
            // Carried through for NO_MATCHING_OPTION (expected-vs-offered) and
            // FUNCTION_ANTECEDENT_CONFLICT (derived function + antecedent detail).
            intended: r.intended,
            options: r.options,
            detail: r.detail,
          }, (r.stableId || r.label || '') + '|' + (r.reason || ''));
        });
        const validation = results.validation || { sections: [], messages: [], invalidFields: [] };
        (validation.invalidFields || []).forEach(function (f) {
          addReview({ stableId: f.stableId || null, label: f.label || f.stableId || 'field', reason: 'INVALID' },
            (f.stableId || f.label || '') + '|INVALID');
        });
        // The host's own remaining-invalid list after repair (the RBT's real to-do list).
        (repair.stillMissing || []).forEach(function (f) {
          addReview({ stableId: f.stableId || null, label: f.label || f.stableId || 'field', reason: 'INVALID' },
            (f.stableId || f.label || '') + '|INVALID');
        });
        const missingSections = (validation.sections || []).filter(function (s) { return s.missingCount > 0; });
        chrome.runtime.sendMessage({
          action: 'fillSummary',
          summary: {
            written: c.attempted,        // fields we wrote a value into
            verifiedOk: c.verified,      // fields confirmed landed (written + repaired)
            repaired: c.repaired,
            skipped: c.skipped,
            failed: c.failed,
            repairPasses: repair.passes || 0,
            needsReview: review,
            missingSections: missingSections,
            messages: validation.messages || [],
          },
        });
      } catch (e) { /* summary is best-effort; never block the fill */ }

      // Passive live-catalog sync: persist the program/behavior lists captured from the selects
      // this fill already opened. Fully best-effort — any failure is logged and ignored, and must
      // never interfere with the fill (which has already completed by this point).
      try {
        const cat = results.catalog || { programs: [], behaviors: [], functions: [] };
        const blockedTerms = (results.validation && results.validation.blockedTerms) || [];
        const clientId = noteData.clientId || null;
        const anyCaptured = (cat.programs && cat.programs.length) ||
          (cat.behaviors && cat.behaviors.length) || (cat.functions && cat.functions.length) ||
          (blockedTerms && blockedTerms.length);
        if (clientId && anyCaptured) {
          chrome.runtime.sendMessage({
            action: 'syncCatalog',
            clientId: clientId,
            source: 'aba_matrix',
            capturedAt: new Date().toISOString(),
            programs: cat.programs || [],
            behaviors: cat.behaviors || [],
            functions: cat.functions || [],
            functionsByBehavior: cat.functionsByBehavior || {},
            blockedTerms: blockedTerms,
            formState: cat.formState || null,
            teachingProcedureRequired: (cat.teachingProcedureRequired === undefined ? null : cat.teachingProcedureRequired),
          }, function () { void chrome.runtime.lastError; /* swallow — never block */ });
        }
      } catch (e) { /* catalog sync is best-effort; never block the fill */ }
    } else {
      sendStatus('⚠️ Executor failed — see console.', 'warning');
    }

    // ── Audit: which scanned fields were planned, and with what value ──
    try {
      const norm = window.__p4NormalizedForm;
      const auditPlan = window.__p4FillPlan || [];
      if (norm && norm.fieldIndex) {
        const plannedIds = new Set(auditPlan.map(function (a) { return a.fieldId; }));
        console.table(
          Object.keys(norm.fieldIndex).map(function (id) {
            const action = auditPlan.find(function (a) { return a.fieldId === id; });
            return {
              field: id,
              planned: plannedIds.has(id) ? '✅' : '❌',
              value: action && action.value != null ? String(action.value).slice(0, 30) : '—'
            };
          })
        );
      }
    } catch (e) {
      console.warn('[Path4ABA] audit table failed:', e);
    }

    return { clinicalFacts: clinicalFacts, normalizedForm: normalizedForm, plan: plan, results: results };
    } catch (e) {
      __agentOk = false;
      console.error('[Path4ABA] runFormAgent error:', e);
      return { clinicalFacts: null, normalizedForm: null, plan: null, results: null, error: String((e && e.message) || e) };
    } finally {
      // TERMINAL SIGNAL — the finally ALWAYS runs, so this fires on the clean end, EVERY early return, and any
      // thrown error. It re-enables the popup's AI Fill button (via done:true). Empty text so it never clobbers
      // the last real status line the listener rendered.
      try { chrome.runtime.sendMessage({ action: 'agentStatus', done: true, level: __agentOk ? 'success' : 'error', text: '' }); } catch (_e) { /* noop */ }
    }
  }

  window.runFormAgent = runFormAgent;
})();
