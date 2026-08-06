// THE single, server-side SessionInput builder. Every entry point (app note form, website, extension)
// POSTs a SLIM request — session selections only — and the server derives everything else from the
// authoritative DB clinical_profile. This replaces three drifted client-side builders (app
// buildSessionInput.ts, the website inline block, the extension popup), so the next gate we add lands
// on all three at once. It is also a security boundary: allowedFunctions / matrixFunctions /
// approvedInterventions are derived here from the assessment, never accepted from the client, so a
// stale or tampered client can't send a constraint set that doesn't match the assessment.

import type { SessionInput } from "./generateSmartNote";
import { nextSessionClause } from "./nextSessionDate.ts";
import { matrixFunctionsForBehavior } from "./functionPatterns.ts";

// The slim payload the clients POST. Everything NOT here is derived from the DB profile.
export type SlimNoteRequest = {
  clientId: string;
  date: string;
  location: string;
  otherLocation?: string;
  present?: string[];
  selectedBehaviors: string[];
  selectedSkills?: string[];
  compliance?: string;
  medicationChange?: boolean;
  envChange?: boolean;
  envChangeDesc?: string;
  missedHours?: boolean;
  missedCount?: string;
  missedReason?: string;
  nextAppt?: string;
  continuityContext?: SessionInput["continuityContext"];
};

// Dual-accept shape detection (extension migration window): the FAT SessionInput carries
// behaviorsObserved; the SLIM payload carries selectedBehaviors. An un-updated extension in the wild
// keeps sending the fat shape, so the route must accept both until adoption is confirmed.
export function isSlimNoteRequest(body: unknown): body is SlimNoteRequest {
  const b = body as Record<string, unknown> | null;
  return !!b && Array.isArray(b.selectedBehaviors) && !Array.isArray(b.behaviorsObserved);
}

const PROHIBITED = [
  "Punishment", "ResponseCost", "Restraint",
  "StandaloneExtinction", "TimeOut", "Overcorrection", "Aversive",
];

// clinical_profile items may be strings or { name } objects.
const getName = (item: unknown): string =>
  typeof item === "string" ? item : ((item as { name?: string } | null)?.name ?? "");

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

// Build the full SessionInput from a slim request + the authoritative DB clinical_profile.
// `columnDiagnosis` is the clients.diagnosis column, used only if the profile JSON has none.
export function buildServerSessionInput(
  slim: SlimNoteRequest,
  profile: any,
  columnDiagnosis?: string | null,
): SessionInput {
  const p = profile || {};
  const mal = asArray(p.maladaptiveBehaviors);
  const home = asArray(p.homeActivities) as string[];
  const school = asArray(p.schoolActivities) as string[];
  const reinforcers = asArray(p.reinforcers) as string[];
  const caregivers = asArray(p.caregivers) as string[];
  const present = slim.present ?? [];
  const presentPerson = present.join(" and ");

  // Diagnosis: REAL from the assessment (the app path historically sent [] — corrected here, approved).
  const diagnosis: string[] = Array.isArray(p.diagnosis)
    ? p.diagnosis
    : typeof p.diagnosis === "string" && p.diagnosis
      ? [p.diagnosis]
      : columnDiagnosis
        ? [columnDiagnosis]
        : [];

  // ABA Matrix dropdown functions (captured by the extension at fill time). Absent for most clients.
  // `current` is the captured catalog: `functions` is the legacy GLOBAL UNION; `functionsByBehavior`
  // (when present) holds each behavior's OWN dropdown. Keep the union top-level for anything global;
  // narrow PER BEHAVIOR below via matrixFunctionsForBehavior (falls back to the union → no regression).
  const captured = p.observedCatalog?.aba_matrix?.current;
  const capturedUnion = captured?.functions;
  const matrixFunctions: string[] | undefined =
    Array.isArray(capturedUnion) && capturedUnion.length ? capturedUnion : undefined;

  return {
    clientId: slim.clientId,
    sessionInfo: {
      date: slim.date,
      timeRange: "",
      location: slim.location,
      caregiver: presentPerson,
      caregiverName: caregivers.join(" and ") || presentPerson,
    },
    // gender/pronouns are TOP-LEVEL on SessionInput (generateSmartNote reads input.gender/pronouns);
    // the old client builders nested them under clientProfile, where they were silently ignored.
    gender: p.gender ?? "",
    pronouns: p.pronouns ?? "",

    behaviorsObserved: (slim.selectedBehaviors ?? []).map((name) => {
      const pb = mal.find((b) => getName(b) === name) as
        | { topographies?: string[]; functions?: string[] }
        | undefined;
      const topographies = pb?.topographies ?? [];
      const functions = pb?.functions ?? [];
      return {
        name,
        topography: topographies[Math.floor(Math.random() * Math.max(topographies.length, 1))] || "",
        frequency: 1,
        antecedentContext: "",
        function: functions[0] || "",
        // Derived from the assessment — the gate enforces the written function stays in this set.
        allowedFunctions: functions,
        // This behavior's OWN captured ABA-Matrix dropdown (falls back to the global union, then
        // undefined). The prompt nudges the note to name a function this behavior can actually record.
        matrixFunctions: matrixFunctionsForBehavior(captured, name),
      };
    }),
    // Derived from the DB, never client-supplied.
    matrixFunctions,

    replacementSkillsAddressed: (slim.selectedSkills ?? []).map((name) => ({
      name, promptLevel: "", clientResponse: "", successful: true,
    })),

    activitiesUsed: (slim.location === "school" ? school : home)
      .slice(0, 4).map((name) => ({ name, preferred: true })),

    reinforcersUsed: reinforcers.slice(0, 3).map((item) => ({
      type: "non-edible" as const, item, deliveredWhen: "contingent on task engagement",
    })),

    clinicalEvents: [
      // HIPAA-conservative med handling (decided during consolidation): state THAT a medication change
      // occurred and its clinical relevance — never the free-text description, which could carry
      // unstripped detail into the prompt. The extension's `Medication change: <free text>` is NOT adopted.
      slim.medicationChange ? "A medication change was reported this session." : "",
      nextSessionClause(slim.nextAppt ?? "", slim.date),
    ].filter(Boolean).join(" "),

    complianceLevel:
      slim.compliance && slim.compliance !== "typical"
        ? (slim.compliance as SessionInput["complianceLevel"])
        : undefined,
    environmentalChangeDescription:
      slim.envChange && slim.envChangeDesc ? slim.envChangeDesc : undefined,
    missedHoursData:
      slim.missedHours && slim.missedCount
        ? { totalHours: parseFloat(slim.missedCount), reason: slim.missedReason ?? "" }
        : undefined,
    continuityContext: slim.continuityContext || undefined,

    clientProfile: {
      diagnosis,
      setting: slim.location === "other" ? (slim.otherLocation || "community setting") : slim.location,
      approvedInterventions: asArray(p.interventions).map(getName),
      prohibitedInterventions: PROHIBITED,
      reinforcers: {
        tangibles: reinforcers.slice(0, 5).join(", "),
        activities: home.slice(0, 3).join(", "),
        social: "verbal praise, high fives, behavior-specific praise",
        people: presentPerson,
      },
      activePrograms: {
        maladaptive: mal.map(getName),
        replacementSkills: [
          ...asArray(p.replacementBehaviors).map(getName),
          ...asArray(p.skillAcquisition).map(getName),
        ],
      },
    },
  };
}
