// The reinforcement-schedule fill value for a goal's "Schedule of Reinforcement" field.
//
// TRANSCRIBE the schedule the note actually states; default to "Continuous" ONLY when the note specifies
// none. The default is the FALLBACK branch — it never overrides a stated value (extract-facts returns the
// real schedule when stated, empty string when not). General: any goal, any client, no hardcode. The filled
// value stays editable in the form, so the RBT can correct it before signing.
export function scheduleFillValue(schedule: unknown): string {
  const stated = typeof schedule === "string" ? schedule.trim() : "";
  return stated ? stated : "Continuous";
}
