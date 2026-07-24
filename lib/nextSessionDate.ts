// ─────────────────────────────────────────────────────────────────────────────
// NEXT-SESSION DATE VALIDATION.
//
// The "next scheduled session" date is a manual input. Nothing used to validate it, and the
// generation prompt was explicitly told to emit it even when it was on or before the session date —
// so a note could schedule its next session in the PAST, which undermines the credibility of every
// date in the record. The rule: a next-session date is valid ONLY when it is STRICTLY AFTER the
// note's own session date. When it is missing, unparseable, or not strictly future, we OMIT the
// sentence entirely rather than emit a wrong date. This module is the single source of truth for
// that rule; its regression battery (nextSessionDate.test.mjs) locks it in.
// ─────────────────────────────────────────────────────────────────────────────

// True only when `next` is a real date strictly AFTER `sessionDate`. Both are typically ISO
// "YYYY-MM-DD" (from <input type="date">). Missing/blank/unparseable -> false (never a default).
export function isValidNextSessionDate(
  next: string | null | undefined,
  sessionDate: string | null | undefined,
): boolean {
  const n = String(next ?? '').trim()
  const s = String(sessionDate ?? '').trim()
  if (!n || !s) return false
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (iso.test(n) && iso.test(s)) return n > s // ISO strings compare correctly as calendar dates
  const nd = Date.parse(n), sd = Date.parse(s)
  if (Number.isNaN(nd) || Number.isNaN(sd)) return false
  return nd > sd
}

// The closing clause to inject into clinicalEvents, or '' when the next date is not strictly future.
// Use this at the point the note form builds clinicalEvents so an invalid date is never even added.
export function nextSessionClause(
  next: string | null | undefined,
  sessionDate: string | null | undefined,
): string {
  return isValidNextSessionDate(next, sessionDate) ? `Next scheduled appointment: ${String(next).trim()}.` : ''
}

const NEXT_APPT_CLAUSE = /\s*Next scheduled appointment:\s*(\d{4}-\d{2}-\d{2}|[^.\n]+?)\s*\.?(?=\s|$)/i

// Server-side chokepoint: strip an invalid "Next scheduled appointment: <date>" clause from a
// clinicalEvents blob when the date is not strictly after the session date. Both note forms funnel
// clinicalEvents through generateSmartNote, so this guarantees a past/equal next-session date never
// reaches the note even if a caller (or a future one) forgot to gate at the form.
export function stripInvalidNextSession(
  clinicalEvents: string | null | undefined,
  sessionDate: string | null | undefined,
): string {
  const text = String(clinicalEvents ?? '')
  const m = text.match(NEXT_APPT_CLAUSE)
  if (!m) return text
  if (isValidNextSessionDate(m[1].trim(), sessionDate)) return text
  return text.replace(NEXT_APPT_CLAUSE, '').replace(/\s{2,}/g, ' ').trim()
}
