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
import { buildActivityLists } from "./curatedActivities.ts";

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
  // LOCKED SOURCES (assessment-derived), restored. reinforcers/home/school activities are the client's
  // approved options FROM THE ASSESSMENT — a locked source, not a fabrication. The note MAY name from
  // them (the REINFORCER/ACTIVITY SOURCE prompt rules already require naming ONLY from what reaches the
  // note here, so no prompt change is needed). Reinforcers are read-time re-split so a stored
  // "tablet or phone" resolves to a single item and the note never renders the unresolved alternative
  // (idempotent — an already-split value is a no-op — so it also fixes existing clients with no migration).
  // Activities merge the assessment's split home/school lists with the curated master list (deduped).
  const reinforcers = splitReinforcerValue(asArray(p.reinforcers)) as string[];
  const { homeActivities, schoolActivities } = buildActivityLists({
    home: asArray(p.homeActivities) as string[],
    school: asArray(p.schoolActivities) as string[],
  });
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
      // When the RBT picks "Other" and types where the session happened, the NOTE must say that
      // place. This used to pass the literal selector value through, and the prompt uses
      // sessionInfo.location verbatim — so a note for a session at the grandmother's house opened
      // "services were provided at other".
      location: slim.location === "other" ? (slim.otherLocation?.trim() || "community setting") : slim.location,
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
        // Deterministic stable fallback (no Math.random — the preselector rotates topography LRU over the
        // full set below and the note narrates that choice).
        topography: topographies[0] || "",
        topographies,
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

    // The skill NAME is the locked source; promptLevel and clientResponse are AUTHORIZED GENERATION —
    // Path generates the implementation detail needed to complete the note, guided by the session's
    // compliance level. They are sent empty so the prompt generates them. `successful` is deliberately
    // NOT set: it does not come back as a hardcoded constant — a compliance-controlled outcome value
    // arrives in a later commit. For now the outcome is generative (the SESSION QUALITY block guides it).
    replacementSkillsAddressed: (slim.selectedSkills ?? []).map((name) => ({
      name, promptLevel: "", clientResponse: "",
    })),

    // ACTIVITIES / REINFORCERS — from the locked assessment sources above. activitiesUsed carries the
    // location-appropriate list; reinforcersUsed carries the (re-split) reinforcer items. No `preferred`
    // (the profile does not record preference) and no hardcoded `deliveredWhen` — the contingency is the
    // one the ABC describes, so it is left blank for the prompt to supply. The REINFORCER/ACTIVITY SOURCE
    // rules require the note to name ONLY what appears here, so this restores correct naming with no
    // prompt change; when a list is empty the same rules fall back to general, non-naming language.
    activitiesUsed: (slim.location === "school" ? schoolActivities : homeActivities)
      .slice(0, 4).map((name) => ({ name })),
    reinforcersUsed: reinforcers.slice(0, 3).map((item) => ({
      type: "non-edible" as const, item, deliveredWhen: "",
    })),

    clinicalEvents: [
      // HIPAA-conservative med handling (decided during consolidation): state THAT a medication change
      // occurred and its clinical relevance — never the free-text description, which could carry
      // unstripped detail into the prompt. The extension's `Medication change: <free text>` is NOT adopted.
      slim.medicationChange ? "A medication change was reported this session." : "",
      nextSessionClause(slim.nextAppt ?? "", slim.date),
    ].filter(Boolean).join(" "),

    // Passed through as selected, INCLUDING "typical". It used to be dropped when typical, so the
    // note had nothing real to shape the skill prose with and the model filled in on its own. This
    // is the RBT's own judgment of the session and it is the only thing that shapes how the skills
    // and behaviors READ.
    complianceLevel: ["typical", "below_typical", "poor"].includes(String(slim.compliance))
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
      // Read the assessment's prohibited list when it has one; the PROHIBITED constant is only the
      // fallback for a profile that never captured it (so the always-banned set still applies).
      prohibitedInterventions: asArray(p.prohibitedInterventions).length
        ? asArray(p.prohibitedInterventions).map(getName)
        : PROHIBITED,
      // Locked-source reinforcer names restored (tangibles + activities from the assessment). The
      // REINFORCER SOURCE prompt rule governs naming (name only from reinforcersUsed, which draws from
      // the same assessment source, so the two channels are consistent). `social` is left EMPTY: the
      // old literal ("verbal praise, high fives, behavior-specific praise") came from no authorized
      // source, so it is a hardcoded injection like the others we removed — the prompt's own praise /
      // verbal-praise-rotation rules generate appropriate social-reinforcement language on their own.
      // `people` is the RBT's marked-present selection.
      reinforcers: {
        tangibles: reinforcers.slice(0, 5).join(", "),
        activities: homeActivities.slice(0, 3).join(", "),
        social: "",
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
