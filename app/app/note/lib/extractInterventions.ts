// Ported VERBATIM from the website's extractInterventionsFromNote
// (app/clients/[id]/page.tsx). This is the app's OWN copy — it does NOT import
// from the website. Returns the canonical names of the interventions actually
// cited in THIS note's text (case-insensitive keyword match), not all approved
// interventions. Two patterns intentionally keep a trailing space ("net ",
// "ncr ") to avoid false matches.
export function extractInterventions(noteText: string): string[] {
  const interventionPatterns: { name: string; patterns: string[] }[] = [
    { name: "FCT", patterns: ["functional communication training", "fct"] },
    { name: "DRA", patterns: ["differential reinforcement of alternative", "dra"] },
    { name: "DRI", patterns: ["differential reinforcement of incompatible", "dri"] },
    { name: "DRO", patterns: ["differential reinforcement of other", "dro"] },
    { name: "Premack Principle", patterns: ["premack principle", "premack"] },
    { name: "Behavior Momentum", patterns: ["behavior momentum", "behavioural momentum", "high-probability sequence", "high probability sequence"] },
    { name: "Redirection", patterns: ["redirection", "redirected", "redirect"] },
    { name: "Prompting", patterns: ["prompting", "prompted", "least-to-most", "most-to-least", "prompt hierarchy", "verbal prompt", "physical prompt", "gestural prompt", "model prompt"] },
    { name: "Prompt Fading", patterns: ["prompt fading", "fading prompts", "faded prompt"] },
    { name: "Visual Schedule", patterns: ["visual schedule", "visual support", "visual cue"] },
    { name: "Environmental Modification", patterns: ["environmental modification", "environmental manipulation", "environmental arrangement"] },
    { name: "Token Economy", patterns: ["token economy", "token board", "token system"] },
    { name: "Response Interruption", patterns: ["response interruption", "response blocking", "risc", "rir"] },
    { name: "Errorless Teaching", patterns: ["errorless teaching", "errorless learning"] },
    { name: "Incidental Teaching", patterns: ["incidental teaching"] },
    { name: "Natural Environment Teaching", patterns: ["natural environment teaching", "net "] },
    { name: "Discrete Trial Training", patterns: ["discrete trial training", "discrete trial", "dtt"] },
    { name: "Activity Schedule", patterns: ["activity schedule"] },
    { name: "Behavior-specific praise", patterns: ["behavior-specific praise", "behaviour-specific praise", "bsp"] },
    { name: "Extinction", patterns: ["extinction procedure", "planned ignoring"] },
    { name: "NCR", patterns: ["noncontingent reinforcement", "fixed-time schedule", "fixed time schedule", "ncr "] },
  ];
  const lower = noteText.toLowerCase();
  return interventionPatterns
    .filter(({ patterns }) => patterns.some((p) => lower.includes(p)))
    .map(({ name }) => name);
}
