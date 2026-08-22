// Assessment Overview status engine (Assessment Builder, Part 3b). PURE and DETERMINISTIC — field presence,
// required-field checks, and cross-field consistency ONLY. NO LLM, NO clinical judgment. Every check here has
// a single unambiguous answer from the data. Checks that would require clinical judgment are NOT implemented
// — they are enumerated in JUDGMENT_DEFERRED below for a human (Marlon) to decide.
//
// Built against the CURRENT clinical_profile shape (what exists today). When the Assessment Builder's section
// structure is approved (design spec 3a), the section list here maps onto it; the per-section logic stays the
// same. Reuses shipped, tested helpers: looksEdible, canonicalIntervention + GENERAL_ABA_FUNCTION_INTERVENTIONS,
// phiDiscardReason — so the dashboard's judgments match the generator's.

import { looksEdible } from './edibleReinforcer.ts';
import { canonicalIntervention } from './interventionCanonical.ts';
import { GENERAL_ABA_FUNCTION_INTERVENTIONS } from './preselect.ts';
import { phiDiscardReason } from './clinicalLibrary.ts';

export type Status = 'green' | 'yellow' | 'red';

export interface SectionStatus {
  key: string;
  label: string;
  status: Status;
  present: boolean;      // does the section have any data at all?
  missing: string[];     // required things absent
  issues: string[];      // cross-field / consistency problems (deterministic)
  advisories: string[];  // heuristic, non-blocking (e.g. possible stray identifier)
}

export interface AssessmentStatus {
  sections: SectionStatus[];
  overallPct: number;                // 0..100, GREEN=1, YELLOW=0.5, RED=0 across weighted sections
  redCount: number;
  yellowCount: number;
  judgmentDeferred: string[];        // checks intentionally NOT implemented (need clinical judgment)
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const asArr = (v: unknown): any[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const nameOf = (x: any): string => (typeof x === 'string' ? x : String(x?.name ?? '')).trim();
const funcsOf = (b: any): string[] => asArr(b?.functions).map((f) => String(f).trim()).filter(Boolean);
const toposOf = (b: any): string[] => asArr(b?.topographies).map((t) => String(t).trim()).filter(Boolean);
// A behavior/skill whose status makes required-field checks apply (note-eligible). Mastered/discontinued items
// are legitimately name-only, so they are exempt from the function/topography requirement.
const requiresDetail = (status: any): boolean => {
  const s = String(status ?? 'active').toLowerCase();
  return s === 'active' || s === 'unknown' || s === '' || s === 'maintenance';
};

// A section's own weight toward overall completion. Required sections weigh 1; optional/informational weigh 0.5.
interface SectionDef { key: string; label: string; weight: number; }
const SECTION_WEIGHTS: SectionDef[] = [
  { key: 'demographics', label: 'Client & diagnosis', weight: 1 },
  { key: 'behaviors', label: 'Maladaptive behaviors', weight: 1 },
  { key: 'skills', label: 'Replacement skills', weight: 1 },
  { key: 'interventions', label: 'Approved interventions', weight: 1 },
  { key: 'reinforcers', label: 'Reinforcers', weight: 1 },
  { key: 'activities', label: 'Activities', weight: 0.5 },
  { key: 'parentTraining', label: 'Parent-training goals', weight: 0.5 },
];

// ── the engine ───────────────────────────────────────────────────────────────────────────────────────────
export function computeAssessmentStatus(profile: any): AssessmentStatus {
  const p = profile || {};
  const sections: SectionStatus[] = [];

  // client's own name tokens — used to distinguish the client's own name (fine) from a STRAY name (contradiction)
  // `||` not `??`: clientName is often an empty string with the real name under `name` (falsy, not nullish).
  const ownNameTokens = new Set(
    String(p.clientName || p.name || '')
      .toLowerCase().split(/[^a-z]+/).filter((t: string) => t.length > 1),
  );

  // 1. DEMOGRAPHICS / DIAGNOSIS — diagnosis required.
  {
    const diagnosis = asArr(p.diagnosis).map(String).filter((s) => s.trim());
    const missing: string[] = [];
    if (!diagnosis.length) missing.push('diagnosis');
    sections.push(mk('demographics', 'Client & diagnosis', diagnosis.length > 0, missing, [], []));
  }

  // 2. MALADAPTIVE BEHAVIORS — ≥1; each note-eligible behavior needs ≥1 function and ≥1 topography.
  {
    const behaviors = asArr(p.maladaptiveBehaviors);
    const missing: string[] = [];
    const issues: string[] = [];
    const advisories: string[] = [];
    if (!behaviors.length) missing.push('at least one behavior');
    for (const b of behaviors) {
      const n = nameOf(b) || '(unnamed behavior)';
      if (!nameOf(b)) issues.push('a behavior has no name');
      if (requiresDetail(b?.status)) {
        if (!funcsOf(b).length) issues.push(`"${n}" has no documented function`);
        if (!toposOf(b).length) issues.push(`"${n}" has no topography/operational definition`);
      }
      // ADVISORY (heuristic, deterministic): a proper name in the narrative that is NOT the client's own name
      // may be a stray reference copied from another client's assessment (Marlon's "Matthew in Brandon's" case).
      for (const t of toposOf(b)) {
        if (phiDiscardReason(t) === 'proper-name') {
          const strayCaps = (t.match(/\b[a-z]+\s+([A-Z][a-z]+)/g) || [])
            .map((m) => m.split(/\s+/).pop() as string)
            .filter((w) => !ownNameTokens.has(w.toLowerCase()));
          if (strayCaps.length) advisories.push(`"${n}": possible stray name/identifier in the definition (${[...new Set(strayCaps)].join(', ')}) — review it is not another client's`);
        }
      }
    }
    sections.push(mk('behaviors', 'Maladaptive behaviors', behaviors.length > 0, missing, issues, advisories));
  }

  // 3. REPLACEMENT SKILLS — ≥1; each note-eligible skill needs a targetFunction; cross-field: the targetFunction
  //    should correspond to a function some active behavior actually has.
  {
    const skills = asArr(p.replacementBehaviors);
    const behaviorFns = new Set(
      asArr(p.maladaptiveBehaviors).flatMap((b) => funcsOf(b)).map((f) => f.toLowerCase()),
    );
    const missing: string[] = [];
    const issues: string[] = [];
    if (!skills.length) missing.push('at least one replacement skill');
    for (const s of skills) {
      const n = nameOf(s) || '(unnamed skill)';
      if (requiresDetail(s?.status)) {
        const tf = String(s?.targetFunction ?? '').trim();
        if (!tf) issues.push(`"${n}" has no target function`);
        else if (behaviorFns.size && !behaviorFns.has(tf.toLowerCase())) {
          issues.push(`"${n}" targets "${tf}" but no active behavior has that function`);
        }
      }
    }
    sections.push(mk('skills', 'Replacement skills', skills.length > 0, missing, issues, []));
  }

  // 4. APPROVED INTERVENTIONS — ≥1; cross-field: each function used by active behaviors should have at least
  //    one approved intervention that fits Path's general map (same canonicalizer the generator uses).
  {
    const interventions = asArr(p.interventions).map(nameOf).filter(Boolean);
    const missing: string[] = [];
    const issues: string[] = [];
    if (!interventions.length) missing.push('at least one approved intervention');
    const usedFns = new Set(
      asArr(p.maladaptiveBehaviors)
        .filter((b) => requiresDetail(b?.status))
        .flatMap((b) => funcsOf(b)).map((f) => f.toLowerCase()),
    );
    if (interventions.length) {
      const canon = interventions.map(canonicalIntervention);
      for (const fn of usedFns) {
        const map = GENERAL_ABA_FUNCTION_INTERVENTIONS[fn];
        if (map && !canon.some((c) => map.includes(c))) {
          issues.push(`no approved intervention fits the "${fn}" function (Path's general map) — those behaviors will use a non-function-matched fallback`);
        }
      }
    }
    sections.push(mk('interventions', 'Approved interventions', interventions.length > 0, missing, issues, []));
  }

  // 5. REINFORCERS — ≥1; deterministic: if ALL are edible, none reach a note (edibles are filtered), so that's
  //    a YELLOW (reuses the shipped looksEdible).
  {
    const reinforcers = asArr(p.reinforcers).map(String).map((s) => s.trim()).filter(Boolean);
    const missing: string[] = [];
    const issues: string[] = [];
    if (!reinforcers.length) missing.push('at least one reinforcer');
    else {
      const nonEdible = reinforcers.filter((r) => !looksEdible(r));
      if (!nonEdible.length) issues.push('every reinforcer is edible — none will appear in notes (edibles are filtered); add a non-edible reinforcer');
    }
    sections.push(mk('reinforcers', 'Reinforcers', reinforcers.length > 0, missing, issues, []));
  }

  // 6. ACTIVITIES — optional; YELLOW if neither home nor school has any.
  {
    const home = asArr(p.homeActivities).map(String).filter((s) => s.trim());
    const school = asArr(p.schoolActivities).map(String).filter((s) => s.trim());
    const present = home.length + school.length > 0;
    const missing = present ? [] : ['home or school activities'];
    sections.push(mk('activities', 'Activities', present, missing, [], []));
  }

  // 7. PARENT-TRAINING GOALS — optional/informational.
  {
    const goals = asArr(p.parentTrainingGoals).map(String).filter((s) => s.trim());
    sections.push(mk('parentTraining', 'Parent-training goals', goals.length > 0, goals.length ? [] : ['parent-training goals'], [], []));
  }

  // overall % — weighted; GREEN=1, YELLOW=0.5, RED=0.
  const weightOf = (k: string) => SECTION_WEIGHTS.find((s) => s.key === k)?.weight ?? 1;
  const score = (s: Status) => (s === 'green' ? 1 : s === 'yellow' ? 0.5 : 0);
  const totalW = sections.reduce((a, s) => a + weightOf(s.key), 0);
  const gotW = sections.reduce((a, s) => a + weightOf(s.key) * score(s.status), 0);
  const overallPct = totalW ? Math.round((gotW / totalW) * 100) : 0;

  return {
    sections,
    overallPct,
    redCount: sections.filter((s) => s.status === 'red').length,
    yellowCount: sections.filter((s) => s.status === 'yellow').length,
    judgmentDeferred: JUDGMENT_DEFERRED,
  };
}

// Status from the deterministic signals: RED if a required thing is missing (or the section is empty); YELLOW
// if present-but-with-issues (or only advisories); GREEN if present and clean.
function mk(key: string, label: string, present: boolean, missing: string[], issues: string[], advisories: string[]): SectionStatus {
  let status: Status;
  if (missing.length || !present) status = 'red';
  else if (issues.length || advisories.length) status = 'yellow';
  else status = 'green';
  return { key, label, status, present, missing, issues, advisories };
}

// Checks intentionally NOT implemented because they require clinical judgment (or data Path does not have).
// Surfaced so Marlon decides whether/how to add them (an LLM assist would need his firewall review).
export const JUDGMENT_DEFERRED: string[] = [
  'Whether a topography is a CLINICALLY ADEQUATE operational definition (measurable, observable) — presence is checked; quality is not.',
  'Whether a documented function is clinically CORRECT for the described behavior (Path does not re-derive the function).',
  'Whether the chosen interventions are clinically APPROPRIATE (only function-fit against a general map is checked, not suitability).',
  'True cross-client contradiction detection (e.g. another client\'s name) — the advisory here is a heuristic name scan; reliable detection needs entity recognition across all clients\' names.',
  'Whether the assessment is "thin/general" in the clinical sense — only field presence/emptiness is measured, not narrative quality or depth.',
  'Whether replacement skills adequately COVER the documented behaviors (1:1 sufficiency is a clinical call, not a presence check).',
  'Reinforcer appropriateness / preference validity (only edible-vs-non-edible is mechanical).',
];
