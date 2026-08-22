// Assessment Builder access rule (Marlon's ruling: BCBA-only). The Builder lives in the BCBA's area — RBTs do
// not do assessments and have no access. This is the ROLE half of the gate; it is combined with
// canAccessClient (assignment/admin) at every call site, so BOTH conditions must hold: an allowed role AND
// assignment to that client (admin satisfies both). Pure + case-insensitive so it is unit-testable and matches
// the existing role checks (see app/clients/page.tsx: 'bcba' | 'bcaba').
export function isAssessmentBuilderRole(role: unknown): boolean {
  const r = String(role ?? "").toLowerCase();
  return r === "bcba" || r === "bcaba" || r === "admin";
}
