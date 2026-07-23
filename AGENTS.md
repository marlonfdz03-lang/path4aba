<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Clinical pattern-matching: match the assertion, not the noun

When a regex/keyword pattern **determines a clinical field** (behavior function, intervention classification, prompt type, behavior topography, incident/medical flags, …), it must match the phrase that ASSERTS the classification — never a bare clinical noun that also appears in ordinary session prose.

The failure class (real bug we hit on all four behavior-function patterns): a bare noun that shows up in reinforcement/activity descriptions leaks into the match. `"sensory"` → sensory play/break/bin; `"attention"` → adult attention / attention to task; `"avoidance"` → avoidance of eye contact; `"tangible"` / `"access to items"` → tangible reinforcer / access to preferred items. Result: escape/tangible/attention behaviors were all mis-derived as Automatic Reinforcement.

The rule: require function-asserting context — `…-maintained/-seeking/-motivated`, `"maintained by …"`, `"to escape the demand"`, `"demand avoidance"`, `"sensory-maintained"` — not the bare noun. `"attention-maintained"` asserts a function; `"adult attention"` describes a person.

When you add or change any such pattern, add/extend an innocent-prose regression battery that must stay unmatched. `lib/functionPatterns.ts` + `lib/functionPatterns.test.mjs` are the reference implementation; run `npm test` (Node's built-in runner, no deps).
