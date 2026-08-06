// The client-profile shape the app note form reads to render its selectors. Note construction moved
// server-side (buildServerSessionInput builds SessionInput from the DB profile), so this type is all
// that remains of the old client-side builder module.
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
  observedCatalog?: { aba_matrix?: { current?: { functions?: string[] } } };
};
