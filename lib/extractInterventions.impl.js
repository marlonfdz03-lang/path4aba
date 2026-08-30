// Canonical intervention-name parser — the SINGLE source of truth. Implementation is plain JS so it can be
// copied VERBATIM into extension/extract-interventions.js (a classic browser script with no module system or
// build step). lib/extractInterventions.ts re-exports it (typed) for the website + PWA, and
// lib/extractInterventionsParity.test.mjs proves the extension port's fenced body is byte-identical to the
// fenced body below AND agrees on a vector battery — so the two copies cannot drift (the __META__ lesson).
//
// Returns the canonical names of the interventions actually CITED in a note's text (case-insensitive keyword
// match), NOT all approved interventions. "net " and "ncr " keep a trailing space on purpose, so "network"
// and "(ncr)" don't false-match.

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

export { extractInterventions };
