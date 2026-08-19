// ─────────────────────────────────────────────────────────────────────────────
// PER-INTERVENTION DOCUMENTATION DETAIL — emitted ONLY for what the client's plan approves.
//
// These blocks used to sit unconditionally in MASTER_RBT_NOTE_PROMPT, so the prompt taught the model
// to write DRA, Behavior Momentum, Token Economy and friends for EVERY client — including clients
// whose plan approves none of them. Two adjacent instructions contradicted each other outright: the
// closed-set rule ("do NOT mention any intervention that is not in that list — not for variety, not
// as an example, not even once") sat three lines above a Behavior Momentum request library the model
// was told to "rotate through". The specific imperative won, the model wrote an unapproved
// intervention, the compliance gate correctly rejected it, and the RBT got a note that would not
// generate at all — an intervention the system itself had advertised.
//
// The fix is structural, not per-intervention: a detail block is emitted only when the client's
// approved list maps onto that canonical key, resolved with the SAME normalizeApproved() the gate
// uses. What the prompt TEACHES and what the gate ALLOWS are now derived from one source, so they
// cannot drift apart again. Adding a new intervention here is safe by construction: it can only ever
// reach a note whose plan approves it.
//
// Keys are interventionPolicy canonical names. An intervention with no entry simply gets no extra
// detail — the general INTERVENTION SPECIFICITY RULES in the master prompt still apply to it.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeApproved } from './interventionPolicy.ts'

export const INTERVENTION_DETAIL: Record<string, string> = {
  DRA: `DRA DEFINITION:
- DRA = delivering reinforcement contingent on the ALTERNATIVE BEHAVIOR occurring. It is not about withholding.
- Always name the specific alternative behavior being reinforced — not just "appropriate behavior" or "task engagement".
  CORRECT: "implemented DRA by reinforcing appropriate worksheet engagement and hands-on-task behavior with verbal praise and access to (fidget toy)"
  INCORRECT: "implemented DRA by delivering reinforcement contingent on appropriate task engagement" — too vague, does not name the alternative behavior
- Never frame DRA as a deprivation or withholding strategy.
- NEVER say just "the RBT implemented DRA" — always describe HOW.
- Natural shorthand: "Differential Reinforcement of Alternative Behavior (DRA)" may become just "DRA" after the first mention.`,

  'Behavior Momentum': `BEHAVIOR MOMENTUM SPECIFICITY:
- When documenting Behavior Momentum, always include examples of the high-probability requests used.
- CORRECT: "implemented Behavior Momentum by presenting simple motor requests such as standing up, handing materials to the RBT, and clapping hands before presenting the transition directive"
- INCORRECT: "implemented Behavior Momentum by providing a series of high-probability requests"
- Natural shorthand: "Behavior Momentum" may become "behavioral momentum procedures" or "high-probability request sequence" after the first mention.

HIGH-PROBABILITY REQUESTS — MANDATORY VARIETY:
Never use the same high-probability requests across notes. Rotate from these pools:
Motor pool: clapping hands, stomping feet, standing up, sitting down, touching head, waving, turning around, jumping once, giving a thumbs up, pushing in chair
Object pool: handing over a pencil, picking up a crayon, placing a block in a bin, stacking two blocks, putting a cap on a marker, handing over a card
Verbal pool: saying their own name, repeating a simple word, answering 'how old are you', identifying a color on a card
Wider library: pointing to a picture card, placing a block in a bin, pushing a button on a toy, waving hello, high five, picking up a dropped item, naming a color, pointing to body parts, opening a container, pressing a button, handing over a spoon, placing feet on the floor, repeating a word, turning a page, putting on a shoe, tapping knees.
Each note must use a DIFFERENT combination of 2-3 requests from different pools. Never repeat 'handing over a pencil and clapping hands' — that combination is banned. Never repeat the same high-probability requests between ABCs in the same note.`,

  'Environmental Modification': `ENVIRONMENTAL MANIPULATION DETAIL — for an environmental change the RBT actually PERFORMED:
- Always include TWO specific changes the RBT made to the environment.
- CORRECT: "implemented Environmental Modification by adjusting the seating arrangement to reduce proximity to distractors and providing a visual schedule to structure the activity sequence"
- INCORRECT: "implemented Environmental Modification by adjusting the environment"
- It is an ANTECEDENT intervention: it occurs BEFORE the behavior as a preventative strategy.
  CORRECT: "Before transitioning to independent work, the RBT implemented environmental manipulation by reducing visual distractions and presenting a visual schedule."
  Do NOT write it as a reactive consequence after behavior unless clinically justified.
- NEVER write this clause because the RBT REPORTED an environmental change (a visitor, an illness, a schedule change, noise). Reported context is documented at the start of the note as context — it is not a procedure anyone performed.`,

  FCT: `FCT DOCUMENTATION — ROLE-AWARE:
- If FCT is an APPROVED REDUCTION intervention for this client, it may be described as RBT-implemented: "the RBT implemented FCT by prompting the client to [specific communication response]".
- If FCT is a replacement SKILL the client is learning, document it as a skill being acquired — "the client practiced requesting a break using functional communication" — NEVER as a behavior-reduction intervention the RBT implemented "to reduce" the behavior.
- Never write FCT as an uncontrolled client behavior ("client used FCT effectively").
- Natural shorthand: "Functional Communication Training (FCT)" may become "FCT" or "functional communication procedures" after the first mention.`,

  Premack: `PREMACK DETAIL:
- Name both sides of the contingency — the lower-probability task completed first and the higher-probability activity that followed.
  CORRECT: "implemented the Premack Principle by presenting the sorting task before access to (bubbles)"
- Natural shorthand: "Premack Principle" may become "Premack strategy" after the first mention.`,

  'Token Economy': `TOKEN ECONOMY DETAIL:
- Name what earned a token and what the tokens were exchanged for.
  CORRECT: "implemented the token economy by delivering a token contingent on each completed sorting trial, exchanged for access to (bubbles)"
- Do NOT state a count of tokens earned or required — numbers are banned everywhere in the note.
- Tokens may be documented as reinforcement ONLY for a client whose plan approves this procedure.`,

  NCR: `NCR (NONCONTINGENT REINFORCEMENT) DETAIL:
- NCR delivers reinforcement on a time-based schedule, INDEPENDENT of behavior — that is what distinguishes it from DRA.
- Name what was delivered and that it was time-based, without stating an interval as a number.
  CORRECT: "implemented noncontingent reinforcement by delivering brief adult attention on a fixed-time basis throughout the work period, independent of the client's behavior"
  INCORRECT: "implemented NCR by reinforcing appropriate behavior" — that is contingent delivery, which is DRA, not NCR.
- Natural shorthand: "Noncontingent Reinforcement (NCR)" may become "NCR" after the first mention.`,
}

// The detail blocks for THIS client, or '' when the plan approves none of them. Resolved through the
// gate's own normalizeApproved, so an assessment naming an intervention in its own words ("Behavioral
// Momentum", "High-Probability Request Sequence") gets the block its canonical key owns.
export function buildInterventionDetail(approved: string[] | undefined | null): string {
  const keys = normalizeApproved(approved)
  const blocks = Object.entries(INTERVENTION_DETAIL)
    .filter(([canonical]) => keys.has(canonical))
    .map(([, text]) => text)
  if (!blocks.length) return ''
  return (
    `\n\n═══════════════════════════════════════\n` +
    `INTERVENTION DOCUMENTATION DETAIL — ONLY the interventions THIS client's plan approves\n` +
    `═══════════════════════════════════════\n` +
    `These are the procedures you may name. An intervention absent from this section is absent from ` +
    `this client's approved plan: never name it, not for variety, not as an example, not even once.\n\n` +
    blocks.join('\n\n')
  )
}
