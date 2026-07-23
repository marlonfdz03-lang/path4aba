// ─────────────────────────────────────────────────────────────────────────────
// FAILURE CLASS: a regex that matches a BARE CLINICAL NOUN which also appears in
// ordinary session prose, and so misclassifies a clinical field.
//
// All four behavior-function patterns originally had this bug:
//   "sensory"    matched sensory play / sensory break / sensory bin (reinforcers)
//   "attention"  matched adult attention / attention to task
//   "avoidance"  matched avoidance of eye contact
//   "tangible" / "access to items" matched tangible reinforcer / access to items
// The result: escape/tangible/attention behaviors whose ABC merely used a sensory
// (or other) reinforcer were all derived as Automatic Reinforcement.
//
// THE RULE (apply everywhere we pattern-match clinical language — function,
// intervention classification, prompt types, behavior topography, etc.):
//   A pattern that DETERMINES a clinical field must match the ASSERTION, not the
//   noun. "attention-maintained" asserts a function; "adult attention" describes
//   a person. Require the function-asserting context (…-maintained/-seeking/
//   -motivated, "maintained by …", "to escape the demand", "demand avoidance",
//   "sensory-maintained", …). Never a bare noun that shows up in reinforcement or
//   activity descriptions.
//
// The regression test (functionPatterns.test.mjs) locks this in: an innocent-prose
// battery must stay unmatched by ALL patterns. Any future pattern change that
// re-introduces a bare-noun match will fail that test.
// ─────────────────────────────────────────────────────────────────────────────

// Behavior-function phrase patterns (tolerant to phrasing variants). Output strings are the
// canonical labels; plan-fill normalizes 'Tangibles' -> the exact ABA Matrix dropdown option.
export const FUNCTION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /attention[-\s]?(maintained|seeking|based|motivated)|maintained by (adult |social )?attention|(seeking|to (seek|gain|access|obtain|recruit)) (adult |social )?attention|attention[-\s]function/i, label: 'Attention' },
  { re: /escape[-\s]?(maintained|motivated)|maintained by escape|escape[-\s]function|to escape (a |the )?(demand|task|activity|instruction|situation)|escape[/\s-]avoidance|avoidance[-\s]?(maintained|motivated)|(demand|task)[-\s]avoidance/i, label: 'Escape' },
  { re: /tangible[s]?[-\s]?(maintained|motivated)|maintained by (access to )?tangibles?|tangible[-\s]function|access[-\s]to[-\s]tangibles?/i, label: 'Tangibles' },
  // Require the FUNCTION context — never bare "automatic"/"sensory", which appear in ubiquitous
  // sensory reinforcers/activities (sensory bin, sensory break).
  { re: /automatic[-\s]?(reinforcement|maintained)|automatically[-\s]?maintained|sensory[-\s]?(reinforcement|maintained|stimulation|seeking|input)|self[-\s]?stimulat|stereotyp/i, label: 'Automatic Reinforcement' },
]
