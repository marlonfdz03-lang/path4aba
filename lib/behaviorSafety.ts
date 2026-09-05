// Clinical-safety layer for intervention selection. An APPROVED, function-appropriate intervention can still
// be WRONG for a specific behavior: "withhold-a-response" procedures — Planned Ignoring and every Extinction
// variant — are legitimate for an attention-maintained tantrum but dangerous for a child bolting for a door,
// hurting themselves, or hitting. Withholding a response there lets the harm continue, and the note documents
// an RBT not reacting to something that needed a reaction.
//
// FAIL-SAFE by design (the asymmetry decides it): withhold-response is permitted ONLY for behaviors POSITIVELY
// classified as attention-maintained and non-harmful. Flight, self-harm, aggression, AND anything unclassified
// are excluded. A false "unsafe" costs only precision (the note documents redirection instead of ignoring —
// still true); a false "safe" ships an unsafe clinical record. With clinical names nobody standardizes,
// unknown MUST mean unsafe.
//
// Matches the ASSERTION — the behavior's topography/identity, name + operational definition — per AGENTS.md.
// Regression battery in behaviorSafety.test.mjs; extend it whenever a pattern changes.

// The unsafe intervention class: withholding a response. Planned Ignoring + all Extinction variants
// (attention/escape/tangible/standalone/"extinction procedures"). Case-insensitive, substring-tolerant so
// canonical and verbose plan names both match.
const WITHHOLD_RESPONSE = /(planned\s*ignor\w*|extinction)/i;

/** True if `name` is a withhold-a-response intervention (Planned Ignoring / any Extinction). */
export function isWithholdResponseIntervention(name: unknown): boolean {
  return WITHHOLD_RESPONSE.test(String(name ?? ''));
}

// POSITIVE safe-list: attention-maintained, non-harmful nuisance behaviors — planned ignoring / attention
// extinction is the textbook response for exactly these. ONLY these permit withhold-response.
const SAFE_FOR_WITHHOLD = /\b(tantrum\w*|whin(?:e|es|ing|y)|cry(?:ing)?|argu(?:e|es|ing|ment\w*)|interrupt\w*|protest\w*|complain\w*|nagg\w*|back[- ]?talk\w*|talking back|calling out|call[- ]?outs?|blurt\w*|tattl\w*|bragg\w*|whimper\w*|demand\w* for attention|demanding attention|attention[- ]?seek\w*|seeking attention|negative attention)\b/i;

// Harm classes — used for the gate's failure MESSAGE and for transparency/reporting, NOT as the gate itself
// (the gate is fail-safe: unsafe = "not on the safe-list"). name + topography text.
const FLIGHT = /\b(elop\w*|bolt\w*|flee\w*|fleeing|runs?\s*(away|off)|running\s*(away|off)|leav\w*\s*(the\s*)?(area|room|seat|premises|building)|toward\w*\s*(the\s*)?(exit|door)|doorknob|out the door|dart\w*|climb\w*)\b/i;
const SELF_HARM = /\b(self[- ]?injur\w*|sib|head[- ]?bang\w*|self[- ]?harm\w*|hits?\s*(him|her|them)self|bit\w*\s*(him|her|them)self|scratch\w*\s*(him|her|them)self|hair[- ]?pull\w*|pica|skin[- ]?pick\w*|mouth\w*\s*(unsafe|non[- ]?edible|inedible|dangerous))\b/i;
const AGGRESSION = /\b(aggress\w*|hitting|hits?\s*(others|peers|staff|adults|people)|kick\w*|punch\w*|slap\w*|pinch\w*|shov\w*|push\w*|spit\w*|bit\w*\s*(others|peers|people)|throw\w*|inappropriate\s*touch\w*)\b/i;

export type BehaviorSafetyClass = 'safe' | 'flight' | 'self-harm' | 'aggression' | 'unclassified';

/**
 * Classify a behavior. Harm classes OVERRIDE the safe-list (an "aggressive tantrum" is aggression, not safe).
 * `topography` is the operational definition / topography text, which often reveals harm a generic name hides.
 */
export function classifyBehaviorSafety(name: string, topography = ''): BehaviorSafetyClass {
  const t = `${name} ${topography}`;
  if (FLIGHT.test(t)) return 'flight';
  if (SELF_HARM.test(t)) return 'self-harm';
  if (AGGRESSION.test(t)) return 'aggression';
  if (SAFE_FOR_WITHHOLD.test(t)) return 'safe';
  return 'unclassified';
}

/** FAIL-SAFE gate: withhold-response is allowed ONLY when the behavior is positively classified 'safe'. */
export function allowsWithholdResponse(name: string, topography = ''): boolean {
  return classifyBehaviorSafety(name, topography) === 'safe';
}

/**
 * Remove withhold-response interventions from a candidate list unless the behavior is safe-classified. Applied
 * BEFORE selection so an unsafe intervention can never be picked — independent of function match and approval.
 */
export function filterUnsafeInterventions(candidates: string[], name: string, topography = ''): string[] {
  if (allowsWithholdResponse(name, topography)) return [...candidates];
  return candidates.filter((c) => !isWithholdResponseIntervention(c));
}
