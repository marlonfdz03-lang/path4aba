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

// Antecedent -> function FALLBACK. Used ONLY when FUNCTION_PATTERNS return no match: the note always
// states the function, so an 'unknown' means extraction missed it — infer from the antecedent, which
// is clinical evidence in the same note. NEVER a default: an antecedent that matches nothing returns
// null. Order matters: automatic (absence-of-social) is checked first so "no social demand" doesn't
// fall to the broad escape "demand"; then the specific verb-driven social functions (item removed ->
// Tangibles, attention shifted -> Attention); then the broad escape (demand/transition).
export const ANTECEDENT_FUNCTION_PATTERNS: { re: RegExp; label: string }[] = [
  { label: 'Automatic Reinforcement', re: /no (clear |observable )?(social|external|environmental)? ?antecedent|no social (antecedent|trigger|demand)|without (a )?(social )?(demand|antecedent|trigger)|independent (activity|play|engagement)|low[- ]stimulation|unstructured (time|period)|monotonous|repetitive task|self[- ]stimulat/i },
  { label: 'Tangibles', re: /(preferred (item|toy|activity|reinforcer)|item|access|tangible)\b[^.]{0,40}\b(removed|withheld|delayed|denied|restricted|taken away|unavailable|out of reach|ended|blocked)|\b(removed|withheld|delayed|denied|restricted|blocked)\b[^.]{0,40}\b(preferred|item|toy|access|reinforcer)|access (was )?(restricted|denied|removed|delayed|blocked)/i },
  { label: 'Attention', re: /attention (was )?(shifted|directed|diverted|removed|unavailable|redirected|elsewhere)|(shifted|directed|diverted|redirected|removed) (adult |social )?attention|attention (to|toward) (another|other|elsewhere)|adult attention|caregiver('?s)? (conversation|attention)|(caregiver|adult|staff|rbt)[^.]{0,25}(conversation|talking|on the phone)|engaged in (a )?conversation|social (interaction|attention) (removed|withheld|unavailable)|attention (was )?unavailable/i },
  { label: 'Escape', re: /demand|instruction|instructed|directed to|told to|asked to|prompted to|task (was )?present|presented with (a |an )?(task|demand|instruction|non[- ]preferred|worksheet|activity)|non[- ]preferred|clean[- ]?up|put(ting)? away|transition (away )?from a? ?preferred|transition (from|to|away)|move to the next|difficult (or lengthy )?task|work demand|complete (a |the )?task/i },
]

export function inferFunctionFromAntecedent(antecedent: string): string | null {
  const ant = String(antecedent || '')
  if (!ant.trim()) return null
  for (const { re, label } of ANTECEDENT_FUNCTION_PATTERNS) {
    if (re.test(ant)) return label
  }
  return null
}
