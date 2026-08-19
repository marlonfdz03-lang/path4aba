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
import { splitReinforcerValue } from "./reinforcers.ts";

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

// The note names WHO THE RBT MARKED PRESENT. The client's caregiver roster is a set of options, not
// an attendance record, so it may only add the relationship the roster records for a name the RBT
// actually selected ("Margot Villar" + roster "Margot Villar (mother)" -> the annotated form).
// Matching is on the bare name because either side may carry a "(relationship)" suffix; an unmatched
// selection — "RBT", a substitute teacher, a name typed today — prints exactly as the RBT entered it.
// A roster entry the RBT did NOT select can never reach the note through this function.
function annotatePresent(present: string[], roster: string[]): string {
  const bare = (s: string) => String(s).replace(/\s*\(.*?\)\s*/g, " ").trim().toLowerCase();
  return present
    .map((sel) => roster.find((r) => bare(r) === bare(sel) && r.length > sel.length) ?? sel)
    .join(" and ");
}

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
  // Read-time reinforcer normalization: the stored profile array may still hold an unresolved
  // alternative ("tablet or phone") — either persisted before the ingest-time " or " split shipped, or
  // written by a path that skipped parseReinforcers. Re-split here so the note names a single item and
  // never renders "(tablet or phone)". Reuses the tested split; idempotent (an already-split value is a
  // no-op), so it also fixes every existing client with no data migration.
  const reinforcers = splitReinforcerValue(asArray(p.reinforcers)) as string[];
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
      // WHO WAS PRESENT THIS SESSION is the RBT's live selection, and it is the identity that
      // prints. `p.caregivers` is the client's roster of AVAILABLE caregiver options — a client
      // normally has several (mother, father, grandmother, teacher) — NOT a statement about who
      // attended today. The roster used to win here, so every note printed the whole roster joined
      // with "and" and silently discarded the RBT's choice: the RBT marked one caregiver and the
      // note named a different one, unchangeable from the form. The roster now only ANNOTATES —
      // it can never substitute, add, or reorder a name.
      caregiver: presentPerson,
      caregiverName: annotatePresent(present, caregivers) || presentPerson,
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
        // ONLY the behaviors the RBT documented this session. This used to send the client's ENTIRE
        // treatment-plan behavior list, which the model then used as fill material to reach the old
        // fixed ABC count — putting behaviors that did not occur into a billable note. The plan's
        // other behaviors are not needed to write this note, so they are not sent.
        maladaptive: (slim.selectedBehaviors ?? []).slice(),
        replacementSkills: [
          ...asArray(p.replacementBehaviors).map(getName),
          ...asArray(p.skillAcquisition).map(getName),
        ],
      },
    },
  };
}
