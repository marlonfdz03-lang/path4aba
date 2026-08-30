// Path4ABA — shared intervention parser, hand-ported for the extension.
//
// The extension has no module system and no build step, so it cannot import lib/extractInterventions.impl.js.
// Everything between the parity fence below is a VERBATIM copy of that file's fenced body, and
// lib/extractInterventionsParity.test.mjs extracts both and asserts they are byte-identical (and agree on a
// vector battery), so the port cannot drift. Edit lib/extractInterventions.impl.js, then re-copy; never edit
// only this file. Exposes window.P4Interventions.extractInterventions(noteText).
(function () {
  'use strict';

// __PARITY_START__
const INTERVENTION_PATTERNS = [
  { name: 'FCT', patterns: ['functional communication training', 'fct'] },
  { name: 'DRA', patterns: ['differential reinforcement of alternative', 'dra'] },
  { name: 'DRI', patterns: ['differential reinforcement of incompatible', 'dri'] },
  { name: 'DRO', patterns: ['differential reinforcement of other', 'dro'] },
  { name: 'Premack Principle', patterns: ['premack principle', 'premack'] },
  { name: 'Behavior Momentum', patterns: ['behavior momentum', 'behavioural momentum', 'high-probability sequence', 'high probability sequence'] },
  { name: 'Redirection', patterns: ['redirection', 'redirected', 'redirect'] },
  { name: 'Prompting', patterns: ['prompting', 'prompted', 'least-to-most', 'most-to-least', 'prompt hierarchy', 'verbal prompt', 'physical prompt', 'gestural prompt', 'model prompt'] },
  { name: 'Prompt Fading', patterns: ['prompt fading', 'fading prompts', 'faded prompt'] },
  { name: 'Visual Schedule', patterns: ['visual schedule', 'visual support', 'visual cue'] },
  { name: 'Environmental Modification', patterns: ['environmental modification', 'environmental manipulation', 'environmental arrangement'] },
  { name: 'Token Economy', patterns: ['token economy', 'token board', 'token system'] },
  { name: 'Response Interruption', patterns: ['response interruption', 'response blocking', 'risc', 'rir'] },
  { name: 'Errorless Teaching', patterns: ['errorless teaching', 'errorless learning'] },
  { name: 'Incidental Teaching', patterns: ['incidental teaching'] },
  { name: 'Natural Environment Teaching', patterns: ['natural environment teaching', 'net '] },
  { name: 'Discrete Trial Training', patterns: ['discrete trial training', 'discrete trial', 'dtt'] },
  { name: 'Activity Schedule', patterns: ['activity schedule'] },
  { name: 'Behavior-specific praise', patterns: ['behavior-specific praise', 'behaviour-specific praise', 'bsp'] },
  { name: 'Extinction', patterns: ['extinction procedure', 'planned ignoring'] },
  { name: 'NCR', patterns: ['noncontingent reinforcement', 'fixed-time schedule', 'fixed time schedule', 'ncr '] },
];

function extractInterventions(noteText) {
  const lower = String(noteText == null ? '' : noteText).toLowerCase();
  return INTERVENTION_PATTERNS
    .filter(function (entry) { return entry.patterns.some(function (p) { return lower.indexOf(p) !== -1; }); })
    .map(function (entry) { return entry.name; });
}
// __PARITY_END__

  if (typeof window !== 'undefined') window.P4Interventions = { extractInterventions: extractInterventions };
})();
