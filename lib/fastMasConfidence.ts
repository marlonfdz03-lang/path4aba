// lib/fastMasConfidence.ts — FAST/MAS confidence guard. Deterministic self-assessment of whether the
// geometric behavior read is trustworthy — computed at RUNTIME from INTRINSIC signals only (no ground
// truth, no client name). Routes the refresh: HIGH → refresh behaviors (source of truth); LOW/UNREAD →
// PRESERVE existing + FLAG (never overwrite good data with an incomplete read; never guess; never drop).
//
// DESIGN NOTE (anti-tuning): the load-bearing triggers are PRINCIPLED BINARY signals — a logical
// contradiction (a mastered behavior also listed active), a structural error (a "behavior" that is really a
// non-behavior section), or nothing-read (0 blocks). They key on the SIGNAL, not on a rate reverse-engineered
// to make one client pass and another fail. In fact the binary triggers route all real cases on their own;
// the majority-unreadable rate is only a general backstop (a natural >50% "we can't read most of them").

import type { Row } from './pdfGeometry.ts'
import { readBehaviorFunctions, readMasteredSkills } from './pdfGeometry.ts'

// Section-header vocabulary that must NEVER be a behavior name — a located "behavior" matching this is a
// structural mis-read (the reader wandered into the caregiver/skills section). Keys on the section words.
const NON_BEHAVIOR_SECTION = /\b(caregiver|training\s*goal|parent|involvement|behaviors?\s*to\s*increase|skill\s*acquisition|social\s*goal|replacement)\b/i
const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const nameMatch = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)) }
const isUnresolved = (name: string) => /unresolved/i.test(name) || !norm(name)

export interface BehaviorFlag { name: string; issue: 'unresolved name' | 'unknown function' }
export interface Confidence {
  level: 'HIGH' | 'LOW' | 'UNREAD'
  route: 'refresh' | 'preserve+flag'
  reasons: string[]              // WHY it is LOW/UNREAD (empty for HIGH)
  perBehaviorFlags: BehaviorFlag[] // individual behaviors to flag for review even on a HIGH read
  behaviorCount: number
}

export function assessConfidence(rows: Row[]): Confidence {
  const bf = readBehaviorFunctions(rows)
  const masteredItems = readMasteredSkills(rows).flatMap((h) => h.items)

  // UNREAD — geometry located no behavior blocks (narrative/prose-woven format). Cannot refresh.
  if (bf.length === 0)
    return { level: 'UNREAD', route: 'preserve+flag', reasons: ['0 behavior blocks located (narrative / prose-woven format — nothing to read)'], perBehaviorFlags: [], behaviorCount: 0 }

  const reasons: string[] = []

  // BINARY TRIGGER 1 — structural mis-read: a located "behavior" is actually a non-behavior section.
  const spurious = bf.filter((b) => NON_BEHAVIOR_SECTION.test(b.behavior))
  if (spurious.length) reasons.push(`spurious non-behavior anchors (structural mis-read): ${[...new Set(spurious.map((s) => s.behavior))].join('; ')}`)

  // BINARY TRIGGER 2 — logical contradiction: a MASTERED-section name also appears in the active set.
  const leaks = bf.filter((b) => masteredItems.some((m) => nameMatch(m, b.behavior)))
  if (leaks.length) reasons.push(`mastered-in-active leak (a mastered behavior listed as active): ${[...new Set(leaks.map((l) => l.behavior))].join(', ')}`)

  // BACKSTOP — majority of located behaviors are unreadable (no name OR no function). Natural >50% boundary.
  const broken = bf.filter((b) => isUnresolved(b.behavior) || b.functions.length === 0)
  if (broken.length * 2 > bf.length) reasons.push(`majority unreadable (${broken.length}/${bf.length} have no resolvable name or no locatable function)`)

  // Per-behavior flags — surfaced for review even when the overall read is HIGH (don't store a nameless or
  // function-less behavior silently). These do NOT by themselves guard the whole set.
  const perBehaviorFlags: BehaviorFlag[] = bf
    .filter((b) => isUnresolved(b.behavior) || b.functions.length === 0)
    .map((b) => ({ name: b.behavior, issue: isUnresolved(b.behavior) ? 'unresolved name' : 'unknown function' }))

  const level = reasons.length ? 'LOW' : 'HIGH'
  return { level, route: level === 'HIGH' ? 'refresh' : 'preserve+flag', reasons, perBehaviorFlags, behaviorCount: bf.length }
}
