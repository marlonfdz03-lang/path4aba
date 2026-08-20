// THE PRESELECTION LAYER (Commit 4, architectural centre). For each RBT-marked behavior and skill, the
// SELECTOR (this code — never GPT) chooses every axis from its LOCKED set, rotating LRU within the set from
// the last-3-saved-notes history. GPT is then handed FIXED assignments and narrates the choice it was given,
// instead of inventing a value and being rejected by a gate after the fact.
//
// THE INVARIANT (property-tested): LRU may only REORDER within a locked set; it can NEVER expand it. If the
// approved interventions are [DRA, Redirection], no history can make the selector produce Behavior Momentum.
// Every axis output is, by construction, a member of the set passed in for it. This is what makes the
// class-A regenerations (unapproved function / intervention / teaching method) structurally impossible — the
// system only ever hands GPT approved values.

import type { NoteContext } from './rotationHistory.ts';
import { TIER_PROMPTS, TIER_RESPONSES, type OutcomeTier } from './complianceTiers.ts';

// ── Clinical data maps ────────────────────────────────────────────────────────────────────────────────
// These NARROW a choice WITHIN an already-approved set (or ARE the locked set, for antecedents). They are a
// conservative initial encoding, tunable — because they only ever narrow, a wrong entry can at worst pick a
// less-ideal-but-still-approved value; it can never step outside authorization.

// A function's own antecedent pool (canonical function -> antecedent keys). This IS the locked set for the
// antecedent axis. The prompt maps a key to observable prose.
export const FUNCTION_ANTECEDENTS: Record<string, string[]> = {
  escape: ['demand-presented', 'task-difficulty', 'directed-transition', 'non-preferred-activity'],
  attention: ['attention-shifted-to-peer', 'adult-engaged-elsewhere', 'delayed-adult-response', 'independent-work-period'],
  tangible: ['preferred-item-removed', 'access-denied', 'item-out-of-reach', 'turn-ended'],
  automatic: ['no-social-antecedent', 'unstructured-moment', 'low-stimulation-period'],
};

// Which interventions fit which function (by INTERVENTION_CATALOG canonical name). Used to NARROW the
// client's approved interventions to the ones appropriate for the chosen function; if the intersection is
// empty, we fall back to the full approved set (still authorized) rather than expand it.
export const FUNCTION_INTERVENTIONS: Record<string, string[]> = {
  escape: ['DRA', 'DRI', 'FCT', 'NCR', 'Demand Fading', 'Behavior Momentum', 'Premack', 'DRO'],
  attention: ['DRA', 'DRI', 'FCT', 'NCR', 'DRO', 'Planned Ignoring'],
  tangible: ['DRA', 'DRI', 'FCT', 'NCR', 'DRO', 'Premack'],
  automatic: ['NCR', 'DRO', 'DRI', 'Environmental Modification'],
};

// Prompt-level and client-response vocabularies, gated by the RBT's compliance selection. These are the
// locked sets for the promptKey / responseKey axes (variety/continuity axes, not authorization).
const PROMPT_LEVELS_BY_COMPLIANCE: Record<string, string[]> = {
  typical: ['independent', 'gestural', 'verbal'],
  below_typical: ['verbal', 'model', 'partial-physical'],
  poor: ['model', 'partial-physical', 'full-physical'],
};
const RESPONSE_KEYS_BY_COMPLIANCE: Record<string, string[]> = {
  typical: ['success', 'partial-success'],
  below_typical: ['partial-success', 'variable'],
  poor: ['variable', 'required-support'],
};
const ALL_PROMPT_LEVELS = ['independent', 'gestural', 'verbal', 'model', 'partial-physical', 'full-physical'];
const ALL_RESPONSE_KEYS = ['success', 'partial-success', 'variable', 'required-support'];
const promptSet = (c?: string) => (c && PROMPT_LEVELS_BY_COMPLIANCE[c]) || ALL_PROMPT_LEVELS;
const responseSet = (c?: string) => (c && RESPONSE_KEYS_BY_COMPLIANCE[c]) || ALL_RESPONSE_KEYS;

// ── LRU core ──────────────────────────────────────────────────────────────────────────────────────────
// Pick the member of `set` whose most-recent use in `recentKnownUses` (newest-first) is furthest back — a
// never-used member wins outright; ties break by set order. GUARANTEE: the result is always a member of
// `set` (or undefined only when `set` is empty). LRU reorders; it never adds.
export function lruPick(set: string[], recentKnownUses: string[]): string | undefined {
  if (!set.length) return undefined;
  if (set.length === 1) return set[0];
  const age = (v: string): number => {
    const i = recentKnownUses.indexOf(v);
    return i === -1 ? Infinity : i; // never used => Infinity (most preferable)
  };
  let best = set[0];
  let bestAge = age(set[0]);
  for (const v of set) {
    const a = age(v);
    if (a > bestAge) { best = v; bestAge = a; }
  }
  return best;
}

// KNOWN uses of one behavior axis across history, newest-first. UNKNOWN (undefined) entries are dropped —
// they contribute nothing (a legacy row that never stored the axis must not read as "used" OR "unused").
const behaviorAxis = (history: NoteContext[], name: string, key: keyof NoteContext['perBehavior'][string]): string[] =>
  history.map((h) => h.perBehavior?.[name]?.[key]).filter((v): v is string => typeof v === 'string');
const skillAxis = (history: NoteContext[], name: string, key: keyof NoteContext['perSkill'][string]): string[] =>
  history.map((h) => h.perSkill?.[name]?.[key]).filter((v): v is string => typeof v === 'string');

// ── Types ─────────────────────────────────────────────────────────────────────────────────────────────
export interface PreselectBehavior {
  name: string;
  allowedFunctions: string[]; // canonical; the LOCKED function set for this behavior (from the assessment)
  topographies?: string[];    // the LOCKED topography set (from the assessment)
}
export interface PreselectSkill { name: string; }

export interface PreselectInput {
  behaviors: PreselectBehavior[];
  skills: PreselectSkill[];
  approvedInterventions: string[]; // LOCKED (assessment)
  approvedMethods: string[];       // LOCKED (approvedTeachingMethods)
  location: string;                // 'home' | 'school' | other
  homeActivities: string[];        // LOCKED
  schoolActivities: string[];      // LOCKED
  complianceLevel?: string;        // 'typical' | 'below_typical' | 'poor'
  // Per-ABC / per-skill outcome tiers from the compliance controller (assignTiers), aligned by index with
  // `behaviors` / `skills`. When present the tier's vocab drives promptKey/responseKey; absent → the
  // compliance-gated vocab is the fallback.
  behaviorTiers?: OutcomeTier[];
  skillTiers?: OutcomeTier[];
  history: NoteContext[];          // readGenerationHistory(clientId, { window: 3 })
}

export interface BehaviorAssignment {
  function?: string;
  antecedentKey?: string;
  interventionName?: string;
  activity?: string;
  topography?: string;
  tier?: string;
  promptKey?: string;
  responseKey?: string;
}
export interface SkillAssignment {
  method?: string;
  activity?: string;
  tier?: string;
  promptKey?: string;
  responseKey?: string;
}
export interface PreselectResult {
  perBehavior: Record<string, BehaviorAssignment>;
  perSkill: Record<string, SkillAssignment>;
  activities: string[];
  // C6: behaviors whose assessment records NO documented function. The selector does not guess a function
  // and does not silently drop the behavior — it skips the function/antecedent axes and surfaces this so
  // the assessment can be fixed. (Built in Commit 2; the preselector emits the same message.)
  integrityFlags: string[];
}

// ── The selector ──────────────────────────────────────────────────────────────────────────────────────
export function preselect(input: PreselectInput): PreselectResult {
  const { history } = input;
  const activityLockedSet = input.location === 'school' ? input.schoolActivities : input.homeActivities;

  const perBehavior: Record<string, BehaviorAssignment> = {};
  const perSkill: Record<string, SkillAssignment> = {};
  const integrityFlags: string[] = [];
  const activities = new Set<string>();

  input.behaviors.forEach((b, i) => {
    const a: BehaviorAssignment = {};
    // Outcome tier (compliance controller). Its vocab subset drives prompt/response; absent → compliance-gated fallback.
    const tier = input.behaviorTiers?.[i];
    if (tier) a.tier = tier;
    const promptVocab = tier ? TIER_PROMPTS[tier] : promptSet(input.complianceLevel);
    const responseVocab = tier ? TIER_RESPONSES[tier] : responseSet(input.complianceLevel);

    // 1. FUNCTION — LRU within this behavior's approved set. Single-function behaviors always use theirs.
    if (b.allowedFunctions?.length) {
      a.function = lruPick(b.allowedFunctions, behaviorAxis(history, b.name, 'function'));
    } else {
      // C6: no documented function — do not guess, do not omit silently.
      integrityFlags.push(`"${b.name}" has no documented function in the assessment — verify the assessment.`);
    }

    // 2. INTERVENTION — approved set, NARROWED to those that fit the chosen function (fallback: full approved
    //    set). Either way the result is a member of approvedInterventions — never outside it.
    const fit = a.function ? FUNCTION_INTERVENTIONS[a.function] : undefined;
    const fitting = fit ? input.approvedInterventions.filter((i) => fit.includes(i)) : [];
    const interventionSet = fitting.length ? fitting : input.approvedInterventions;
    a.interventionName = lruPick(interventionSet, behaviorAxis(history, b.name, 'interventionName'));

    // 3. ANTECEDENT — the chosen function's own pool (skipped when function is unknown).
    if (a.function && FUNCTION_ANTECEDENTS[a.function]?.length) {
      a.antecedentKey = lruPick(FUNCTION_ANTECEDENTS[a.function], behaviorAxis(history, b.name, 'antecedentKey'));
    }

    // 4. ACTIVITY — the setting's authorized list.
    a.activity = lruPick(activityLockedSet, behaviorAxis(history, b.name, 'activity'));
    if (a.activity) activities.add(a.activity);

    // 5. TOPOGRAPHY — the assessment's set for this behavior (replaces the old Math.random pick).
    if (b.topographies?.length) {
      a.topography = lruPick(b.topographies, behaviorAxis(history, b.name, 'topography'));
    }

    // 6/7. PROMPT + RESPONSE — the tier's vocab subset (or compliance-gated fallback), LRU-rotated.
    a.promptKey = lruPick(promptVocab, behaviorAxis(history, b.name, 'promptKey'));
    a.responseKey = lruPick(responseVocab, behaviorAxis(history, b.name, 'responseKey'));

    perBehavior[b.name] = a;
  });

  input.skills.forEach((s, i) => {
    const a: SkillAssignment = {};
    const tier = input.skillTiers?.[i];
    if (tier) a.tier = tier;
    const promptVocab = tier ? TIER_PROMPTS[tier] : promptSet(input.complianceLevel);
    const responseVocab = tier ? TIER_RESPONSES[tier] : responseSet(input.complianceLevel);
    a.method = lruPick(input.approvedMethods, skillAxis(history, s.name, 'method'));
    a.activity = lruPick(activityLockedSet, skillAxis(history, s.name, 'activity'));
    if (a.activity) activities.add(a.activity);
    a.promptKey = lruPick(promptVocab, skillAxis(history, s.name, 'promptKey'));
    a.responseKey = lruPick(responseVocab, skillAxis(history, s.name, 'responseKey'));
    perSkill[s.name] = a;
  });

  return { perBehavior, perSkill, activities: [...activities], integrityFlags };
}

// Render the assignments as the FIXED ASSIGNMENTS block handed to GPT. Every value here came from a locked
// set (the invariant), so this block, by construction, contains only approved content — GPT narrates it, it
// does not choose. Empty result → empty string (no behaviors/skills to assign).
export function buildFixedAssignmentsBlock(result: PreselectResult): string {
  const lines: string[] = [];
  for (const [name, a] of Object.entries(result.perBehavior)) {
    const parts: string[] = [];
    if (a.function) parts.push(`function: ${a.function}`);
    if (a.antecedentKey) parts.push(`antecedent: ${a.antecedentKey}`);
    if (a.interventionName) parts.push(`intervention: ${a.interventionName}`);
    if (a.activity) parts.push(`activity: ${a.activity}`);
    if (a.topography) parts.push(`topography: ${a.topography}`);
    if (a.tier) parts.push(`outcome tier: ${a.tier}`);
    if (a.promptKey) parts.push(`prompt level: ${a.promptKey}`);
    if (a.responseKey) parts.push(`client-response tenor: ${a.responseKey}`);
    lines.push(`- Behavior "${name}" → ${parts.join('; ')}`);
  }
  for (const [name, a] of Object.entries(result.perSkill)) {
    const parts: string[] = [];
    if (a.method) parts.push(`teaching method: ${a.method}`);
    if (a.activity) parts.push(`activity: ${a.activity}`);
    if (a.tier) parts.push(`outcome tier: ${a.tier}`);
    if (a.promptKey) parts.push(`prompt level: ${a.promptKey}`);
    if (a.responseKey) parts.push(`client-response tenor: ${a.responseKey}`);
    lines.push(`- Skill "${name}" → ${parts.join('; ')}`);
  }
  if (!lines.length) return '';
  return (
    `\n\nFIXED ASSIGNMENTS — SELECTED FOR YOU FROM THE CLIENT'S APPROVED PLAN. Do NOT choose, substitute, ` +
    `or add. Narrate EXACTLY what is assigned below — your job is observable prose, not selection. Never ` +
    `name a function, intervention, teaching method, or activity that is not in this list. Render each ` +
    `antecedent key as observable prose per the ANTECEDENT KEYS guide (never print the key itself).\n` +
    lines.join('\n')
  );
}
