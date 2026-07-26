// Builds the POST /api/generate-note request body from the app note form.
//
// This is the APP's OWN copy (Option B): it intentionally does NOT import the
// website's inline version in app/clients/[id]/page.tsx. It mirrors that logic
// so generated notes come out equivalent.

import { nextSessionClause } from "@/lib/nextSessionDate";

export type NoteFormValues = {
  clientId: string;
  date: string;
  location: string;
  otherLocation: string;
  present: string[];
  behaviors: string[];
  skills: string[];
  compliance: string;
  medicationChange: boolean;
  envChange: boolean;
  envChangeDesc: string;
  missedHours: boolean;
  missedCount: string;
  missedReason: string;
  nextAppt: string;
};

export type NoteClientProfile = {
  name?: string;
  gender?: string;
  pronouns?: string;
  diagnosis?: string[];
  interventions?: unknown[];
  reinforcers?: string[];
  homeActivities?: string[];
  schoolActivities?: string[];
  maladaptiveBehaviors?: unknown[];
  replacementBehaviors?: unknown[];
  skillAcquisition?: unknown[];
};

const PROHIBITED = [
  "Punishment", "ResponseCost", "Restraint",
  "StandaloneExtinction", "TimeOut", "Overcorrection", "Aversive",
];

// clinical_profile items may be strings or { name } objects.
const getName = (item: unknown): string =>
  typeof item === "string" ? item : ((item as { name?: string } | null)?.name ?? "");

export function buildSessionInput(
  form: NoteFormValues,
  profile: NoteClientProfile,
  continuityContext?: unknown,
): Record<string, unknown> {
  const presentPerson = form.present.join(" and ");
  const mal = profile.maladaptiveBehaviors ?? [];
  const home = profile.homeActivities ?? [];
  const school = profile.schoolActivities ?? [];
  const reinforcers = profile.reinforcers ?? [];

  return {
    clientId: form.clientId,
    sessionInfo: { date: form.date, location: form.location, caregiver: presentPerson },

    behaviorsObserved: form.behaviors.map((name) => {
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
        // Full assessment-approved set — the generation gate enforces the written function stays in it.
        allowedFunctions: functions,
      };
    }),

    replacementSkillsAddressed: form.skills.map((name) => ({
      name, promptLevel: "", clientResponse: "", successful: true,
    })),

    activitiesUsed: (form.location === "school" ? school : home)
      .slice(0, 4)
      .map((name) => ({ name, preferred: true })),

    reinforcersUsed: reinforcers.slice(0, 3).map((item) => ({
      type: "non-edible", item, deliveredWhen: "contingent on task engagement",
    })),

    clientProfile: {
      // Mirrors the website: its client object has no `diagnosis` property, so it
      // always sends []. Revisit if the website starts sending real diagnosis.
      diagnosis: [],
      gender: profile.gender ?? "",
      pronouns: profile.pronouns ?? "",
      setting: form.location === "other" ? (form.otherLocation || "community setting") : form.location,
      approvedInterventions: (profile.interventions ?? []).map(getName),
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
          ...(profile.replacementBehaviors ?? []).map(getName),
          ...(profile.skillAcquisition ?? []).map(getName),
        ],
      },
    },

    clinicalEvents: [
      form.medicationChange ? "Medication consumed today." : "",
      // Only emit the next-session date when it is strictly AFTER the session date; otherwise omit.
      nextSessionClause(form.nextAppt, form.date),
    ].filter(Boolean).join(" "),

    complianceLevel: form.compliance !== "typical" ? form.compliance : undefined,
    environmentalChangeDescription:
      form.envChange && form.envChangeDesc ? form.envChangeDesc : undefined,
    missedHoursData:
      form.missedHours && form.missedCount
        ? { totalHours: parseFloat(form.missedCount), reason: form.missedReason }
        : undefined,
    continuityContext: continuityContext || undefined,
  };
}
