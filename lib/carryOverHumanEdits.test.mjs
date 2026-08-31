// Tests for carryOverHumanEdits — preserving human edits across an assessment refresh. Run: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { carryOverHumanEdits } from "./carryOverHumanEdits.ts";

const EDIT = { editedBy: "Yuneisy", editedAt: "2026-08-01T00:00:00Z" };

test("a human-edited function SURVIVES a refresh whose new read is inferred", () => {
  const existing = { maladaptiveBehaviors: [
    { name: "Tantrum", functions: ["escape"], functionsSource: "human-edited", functionsEditedBy: EDIT.editedBy, functionsEditedAt: EDIT.editedAt },
  ] };
  const refreshed = { maladaptiveBehaviors: [
    { name: "Tantrum", functions: ["attention"], functionsEvidence: "inferred" }, // re-inferred, DIFFERENT
  ] };
  const { profile, flags } = carryOverHumanEdits(refreshed, existing);
  const t = profile.maladaptiveBehaviors[0];
  assert.deepEqual(t.functions, ["escape"]);            // the human correction won over the re-inference
  assert.equal(t.functionsSource, "human-edited");
  assert.equal(t.functionsEditedBy, "Yuneisy");
  assert.equal(t.functionsEditedAt, EDIT.editedAt);
  assert.equal(flags.length, 0);
});

test("a renamed-within-matching behavior still carries the edit (shared normalizer)", () => {
  const existing = { maladaptiveBehaviors: [
    { name: "Off-task behavior", topographies: ["RBT definition"], topographySource: "human-edited", topographyEditedBy: EDIT.editedBy, topographyEditedAt: EDIT.editedAt },
  ] };
  const refreshed = { maladaptiveBehaviors: [
    { name: "Off Task Behavior", topographies: [] }, // renamed + still no document topography
  ] };
  const { profile, flags } = carryOverHumanEdits(refreshed, existing);
  assert.deepEqual(profile.maladaptiveBehaviors[0].topographies, ["RBT definition"]);
  assert.equal(profile.maladaptiveBehaviors[0].topographySource, "human-edited");
  assert.equal(flags.length, 0);
});

test("a name changed BEYOND matching produces human-edit-dropped, and applies nowhere", () => {
  const existing = { maladaptiveBehaviors: [
    { name: "Skin picking", topographies: ["manual def"], topographySource: "human-edited", topographyEditedBy: EDIT.editedBy, topographyEditedAt: EDIT.editedAt },
  ] };
  const refreshed = { maladaptiveBehaviors: [ { name: "Elopement", topographies: ["x"] } ] };
  const { profile, flags } = carryOverHumanEdits(refreshed, existing);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].source, "human-edit-dropped");
  assert.ok(flags[0].field.includes("Skin picking"));
  assert.deepEqual(profile.maladaptiveBehaviors[0].topographies, ["x"]); // untouched — never misattached
  assert.equal(profile.maladaptiveBehaviors[0].topographySource, undefined);
});

test("a DOCUMENTED new value supersedes the human edit (+ human-edit-superseded flag)", () => {
  const existing = { maladaptiveBehaviors: [
    { name: "Tantrum", topographies: ["old manual"], topographySource: "human-edited", topographyEditedBy: EDIT.editedBy, topographyEditedAt: EDIT.editedAt,
      functions: ["escape"], functionsSource: "human-edited", functionsEditedBy: EDIT.editedBy, functionsEditedAt: EDIT.editedAt },
  ] };
  const refreshed = { maladaptiveBehaviors: [
    { name: "Tantrum", topographies: ["documented definition"], functions: ["attention"], functionsEvidence: "documented-functional-assessment" },
  ] };
  const { profile, flags } = carryOverHumanEdits(refreshed, existing);
  const t = profile.maladaptiveBehaviors[0];
  assert.deepEqual(t.topographies, ["documented definition"]); // document won
  assert.deepEqual(t.functions, ["attention"]);                // documented functions won
  assert.equal(t.topographySource, undefined);                 // manual not carried
  assert.equal(t.functionsSource, undefined);
  assert.equal(flags.filter((f) => f.source === "human-edit-superseded").length, 2); // both fields flagged
});

test("an AMBIGUOUS name match refuses — flagged, applied to neither", () => {
  const existing = { maladaptiveBehaviors: [
    { name: "Tantrum 2", functions: ["escape"], functionsSource: "human-edited", functionsEditedBy: EDIT.editedBy, functionsEditedAt: EDIT.editedAt },
  ] };
  const refreshed = { maladaptiveBehaviors: [ { name: "Tantrum" }, { name: "Tantrum 22" } ] }; // both strict-match, no exact
  const { profile, flags } = carryOverHumanEdits(refreshed, existing);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].source, "human-edit-dropped");
  assert.equal(profile.maladaptiveBehaviors[0].functionsSource, undefined);
  assert.equal(profile.maladaptiveBehaviors[1].functionsSource, undefined);
});
