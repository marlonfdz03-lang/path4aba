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
import { canonicalIntervention } from './interventionCanonical.ts';

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
// GENERAL ABA KNOWLEDGE — the best-practice intervention families for each behavioral function. This is
// PATH GUIDANCE, NOT assessment-derived: no client's assessment documents a function→intervention mapping
// (audit confirmed), so this map is the only source of function-fit. Values are canonical intervention ids
// (see interventionCanonical.ts); a client's approved list is canonicalized and intersected with these.
// Anywhere this relationship is displayed it MUST be labeled Path guidance, never presented as extracted
// from the treatment plan. It is deliberately kept SMALL and defensible — do NOT widen it to force a fit
// (e.g. automatic staying {DRI, DRO} for a client without NCR is correct; adding a semantic alias to pad it
// is a Clinical Library curation decision, never a code guess here).
export const GENERAL_ABA_FUNCTION_INTERVENTIONS: Record<string, string[]> = {
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
export function lruPick(set: string[], recentKnownUses: string[], rotationOffset = 0): string | undefined {
  if (!set.length) return undefined;
  if (set.length === 1) return set[0];
  const age = (v: string): number => {
    const i = recentKnownUses.indexOf(v);
    return i === -1 ? Infinity : i; // never used => Infinity (most preferable)
  };
  // The equally-oldest candidates. At a COLD START every member ties at Infinity, and the old code broke that
  // tie by set order — so an empty/UNKNOWN history froze the pick on set[0] FOREVER: a rotation that never
  // rotates (Dragon Ball Z in 8/9 notes; every un-derivable axis for a no-history client). We now rotate
  // WITHIN the oldest-tie by a caller-supplied offset (the client's note count + a per-item salt) so a cold
  // start still varies. As real history accrues the tie shrinks to the genuinely-oldest and ordinary LRU takes
  // over. rotationOffset default 0 reproduces the legacy set-order pick, so existing callers/tests are
  // unchanged until they pass an offset.
  let oldest = -1;
  for (const v of set) { const a = age(v); if (a > oldest) oldest = a; }
  const tied = set.filter((v) => age(v) === oldest);
  if (tied.length === 1) return tied[0];
  const idx = ((rotationOffset % tied.length) + tied.length) % tied.length; // guard negative offsets
  return tied[idx];
}

// Full LRU ordering of `set`: least-recently-used first, ties rotated by offset. Built by repeatedly taking the
// lruPick winner and feeding it back as "just used", so it shares lruPick's exact policy (cold-start tie-break
// included). Used for the note-level reinforcer axis, where the note names SEVERAL items and we want the whole
// short list reordered, not a single pick.
export function lruOrder(set: string[], recentKnownUses: string[], rotationOffset = 0): string[] {
  const out: string[] = [];
  let pool = [...set];
  let recent = [...recentKnownUses];
  let k = 0;
  while (pool.length) {
    const pick = lruPick(pool, recent, rotationOffset + k);
    if (pick === undefined) break;
    out.push(pick);
    pool = pool.filter((x) => x !== pick);
    recent = [pick, ...recent];
    k++;
  }
  return out;
}

// Stable, well-distributed non-negative salt from a string, so two items sharing an identical locked set AND an
// empty history don't both land on the same cold-start tie-break index within one note. Deterministic (no RNG)
// so a note stays reproducible. NOT security-sensitive.
function saltHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
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
  // Cold-start tie-break offset for lruPick — the client's ACTIVE note count. Distinct from history.length
  // (which is 0 exactly when rotation is broken): this increments on every saved note regardless of whether it
  // recorded generation_context, so it varies even for a no-history client, letting the tie-break rotate a
  // frozen axis. Optional; default 0 = legacy set-order pick.
  rotationOffset?: number;
  // The FULL edible/outing/person-filtered reinforcer survivor list (buildServerSessionInput). The note-level
  // reinforcer axis rotates over THIS, not the pre-sliced top-3, so every survivor gets airtime across sessions.
  reinforcerSurvivors?: string[];
}

// How the intervention was selected. 'function-matched': the client's approved list contained an
// intervention in the general function-fit map for this behavior's function. 'approved-global-fallback': no
// approved intervention fit the function, so one was picked from the full approved list — NOT a
// function-matched selection (internal/admin visibility only; never stated in the note prose).
export type InterventionFit = 'function-matched' | 'approved-global-fallback';

export interface BehaviorAssignment {
  function?: string;
  antecedentKey?: string;
  interventionName?: string;
  interventionFit?: InterventionFit;
  activity?: string;
  topography?: string;
  tier?: OutcomeTier;
  promptKey?: string;
  responseKey?: string;
}
export interface SkillAssignment {
  method?: string;
  activity?: string;
  tier?: OutcomeTier;
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
  // AUDITABILITY: the assigned outcome tier per behavior / per skill, name→tier, mirrored to the top level so
  // a saved note's generation_context answers "what tier was this skill assigned?" with a single lookup
  // (generation_context->'skillTiers'->'Request Break') instead of digging into perSkill[...].tier. The math
  // is assignTiers(); this only records what it decided, so tier questions are answerable from data, not prose.
  behaviorTiers: Record<string, OutcomeTier>;
  skillTiers: Record<string, OutcomeTier>;
  // AUDITABILITY: per-behavior intervention selection provenance, name→fit, mirrored to the top level like
  // the tiers. 'approved-global-fallback' marks a behavior whose function had no approved intervention that
  // fits the general map — so admins can see which selections are NOT function-matched.
  interventionFit: Record<string, InterventionFit>;
  // NOTE-LEVEL REINFORCER AXIS (the Dragon Ball Z fixation fix). `reinforcers` is the top-3 actually offered to
  // the note — the axis the history reader reads back (NoteContext.reinforcers) so the next note can rotate
  // against it. `reinforcersOrder` is the FULL LRU-rotated survivor list, so the caller builds both naming
  // channels — reinforcersUsed(3) and the tangibles(5) context list — from ONE rotated order (otherwise
  // tangibles would still lead with the frozen set[0] item and the model would re-name it).
  reinforcers: string[];
  reinforcersOrder: string[];
}

// ── The selector ──────────────────────────────────────────────────────────────────────────────────────
export function preselect(input: PreselectInput): PreselectResult {
  const { history } = input;
  const rot = input.rotationOffset ?? 0;
  // Per-(item, axis) tie-break offset: note count + a stable salt so two items with an identical locked set and
  // an empty history don't collide on the same cold-start pick. Only matters when that axis's history is
  // empty/tied; once real history exists lruPick ignores it (the oldest tie is a singleton).
  const boff = (name: string, key: string): number => rot + saltHash(name + '|' + key);
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
      a.function = lruPick(b.allowedFunctions, behaviorAxis(history, b.name, 'function'), boff(b.name, 'function'));
    } else {
      // C6: no documented function — do not guess, do not omit silently.
      integrityFlags.push(`"${b.name}" has no documented function in the assessment — verify the assessment.`);
    }

    // 2. INTERVENTION — the client's approved list ∩ the general function-fit map (canonicalized on both
    //    sides so "Differential Reinforcement of Alternative Behavior (DRA)" matches the map's "DRA"). If
    //    something fits → function-matched selection. If NOTHING fits → the note still needs an intervention,
    //    so pick from the full approved list, but MARK it 'approved-global-fallback' — it is NOT presented as
    //    function-matched (the old code silently used the full list and passed a coincidental pick off as a
    //    function match; that is the bug being removed). The result is always a member of approvedInterventions.
    const fitIds = a.function ? GENERAL_ABA_FUNCTION_INTERVENTIONS[a.function] : undefined;
    const fitting = fitIds
      ? input.approvedInterventions.filter((i) => fitIds.includes(canonicalIntervention(i)))
      : [];
    if (fitting.length) {
      a.interventionName = lruPick(fitting, behaviorAxis(history, b.name, 'interventionName'), boff(b.name, 'interventionName'));
      a.interventionFit = 'function-matched';
    } else {
      a.interventionName = lruPick(input.approvedInterventions, behaviorAxis(history, b.name, 'interventionName'), boff(b.name, 'interventionName'));
      a.interventionFit = 'approved-global-fallback';
      if (a.function) {
        integrityFlags.push(`"${b.name}" (${a.function}): no approved intervention fits this function in Path's general map — selected "${a.interventionName ?? ''}" from the approved list as a non-function-matched fallback.`);
      }
    }

    // 3. ANTECEDENT — the chosen function's own pool (skipped when function is unknown).
    if (a.function && FUNCTION_ANTECEDENTS[a.function]?.length) {
      a.antecedentKey = lruPick(FUNCTION_ANTECEDENTS[a.function], behaviorAxis(history, b.name, 'antecedentKey'), boff(b.name, 'antecedentKey'));
    }

    // 4. ACTIVITY — the setting's authorized list.
    a.activity = lruPick(activityLockedSet, behaviorAxis(history, b.name, 'activity'), boff(b.name, 'activity'));
    if (a.activity) activities.add(a.activity);

    // 5. TOPOGRAPHY — the assessment's set for this behavior (replaces the old Math.random pick).
    if (b.topographies?.length) {
      a.topography = lruPick(b.topographies, behaviorAxis(history, b.name, 'topography'), boff(b.name, 'topography'));
    }

    // 6/7. PROMPT + RESPONSE — the tier's vocab subset (or compliance-gated fallback), LRU-rotated.
    a.promptKey = lruPick(promptVocab, behaviorAxis(history, b.name, 'promptKey'), boff(b.name, 'promptKey'));
    a.responseKey = lruPick(responseVocab, behaviorAxis(history, b.name, 'responseKey'), boff(b.name, 'responseKey'));

    perBehavior[b.name] = a;
  });

  input.skills.forEach((s, i) => {
    const a: SkillAssignment = {};
    const tier = input.skillTiers?.[i];
    if (tier) a.tier = tier;
    const promptVocab = tier ? TIER_PROMPTS[tier] : promptSet(input.complianceLevel);
    const responseVocab = tier ? TIER_RESPONSES[tier] : responseSet(input.complianceLevel);
    a.method = lruPick(input.approvedMethods, skillAxis(history, s.name, 'method'), boff(s.name, 'method'));
    a.activity = lruPick(activityLockedSet, skillAxis(history, s.name, 'activity'), boff(s.name, 'activity'));
    if (a.activity) activities.add(a.activity);
    a.promptKey = lruPick(promptVocab, skillAxis(history, s.name, 'promptKey'), boff(s.name, 'promptKey'));
    a.responseKey = lruPick(responseVocab, skillAxis(history, s.name, 'responseKey'), boff(s.name, 'responseKey'));
    perSkill[s.name] = a;
  });

  // Mirror the assigned tiers (already on each perBehavior/perSkill entry) to top-level name→tier maps.
  const behaviorTiers: Record<string, OutcomeTier> = {};
  for (const [name, a] of Object.entries(perBehavior)) if (a.tier) behaviorTiers[name] = a.tier;
  const skillTiers: Record<string, OutcomeTier> = {};
  for (const [name, a] of Object.entries(perSkill)) if (a.tier) skillTiers[name] = a.tier;
  // Mirror the intervention selection provenance to a top-level name→fit map.
  const interventionFit: Record<string, InterventionFit> = {};
  for (const [name, a] of Object.entries(perBehavior)) if (a.interventionFit) interventionFit[name] = a.interventionFit;

  // NOTE-LEVEL REINFORCER AXIS. History = the reinforcers named in recent notes (newest-first, flattened).
  // lruOrder rotates the survivor list so the PRIMARY reinforcer changes session-to-session instead of freezing
  // on the first survivor (Dragon Ball Z in 5/8 notes). Record only the top-3 as the axis — what the note
  // actually names — so the next note sees a rotatable signal rather than "every survivor used every time".
  const reinforcerHistory = history.flatMap((h) => h.reinforcers ?? []);
  const reinforcersOrder = lruOrder(input.reinforcerSurvivors ?? [], reinforcerHistory, rot);
  const reinforcers = reinforcersOrder.slice(0, 3);

  return { perBehavior, perSkill, activities: [...activities], integrityFlags, behaviorTiers, skillTiers, interventionFit, reinforcers, reinforcersOrder };
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
