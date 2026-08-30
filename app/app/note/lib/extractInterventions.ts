// The PWA's intervention parser is now the SHARED canonical one (lib/extractInterventions) — no local copy.
// Re-exported here so existing importers (./lib/extractInterventions) keep working unchanged. One source for
// web, PWA, and the extension port; lib/extractInterventionsParity.test.mjs guards the extension copy.
export { extractInterventions } from "@/lib/extractInterventions";
