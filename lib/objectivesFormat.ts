// lib/objectivesFormat.ts — the third assessment format (Ximena): behaviors as "<Name> … Description:
// <definition>" blocks PLUS an "Objectives:" STO table, and the reduce-target list as a prose capsule.
//
// This assembles a DETERMINISTIC active-behavior set from the geometry readers (no LLM), removing Ximena's
// run-to-run non-determinism: the reduce-target capsule is authoritative for MEMBERSHIP; each target's status
// comes from its Objectives STO table (active unless ALL STOs mastered); its operational definition comes from
// its Description block. A per-STO "Mastered" is a milestone, never behavior mastery. Fails safe: too few
// targets, or fewer than half carry a definition → { found:false } and the caller keeps the existing LLM path.

import type { Row } from './pdfGeometry.ts'
import { readReduceTargets, readObjectivesStatus, readDescriptionBlocks } from './pdfGeometry.ts'

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const acronym = (s: string) => s.split(/\s+/).map((w) => w[0] || '').join('')
// Match a reduce-target name to a Description/Objectives name, tolerant of the doc's variants: containment,
// acronym ("SIB" == initials of "Self Injury Behavior"), and token-subset ("Off Task Behavior" vs "Off-Task").
export function objMatch(a: string, b: string): boolean {
  const x = norm(a), y = norm(b)
  if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  const shortSquished = short.replace(/\s/g, '')
  if (shortSquished.length >= 2 && shortSquished.length <= 4 && acronym(long) === shortSquished) return true
  const tx = new Set(x.split(' ').filter((t) => t.length >= 3)), ty = new Set(y.split(' ').filter((t) => t.length >= 3))
  if (!tx.size || !ty.size) return false
  const shared = [...tx].filter((t) => ty.has(t)).length
  return shared >= 2 && shared >= Math.min(tx.size, ty.size)
}

export interface ObjectivesBehavior { name: string; status: 'active'; topography: string; baseline: string }
export interface ObjectivesRead { behaviors: ObjectivesBehavior[]; masteredNames: string[]; targets: string[]; found: boolean }

export function readObjectivesFormat(rows: Row[]): ObjectivesRead {
  const targets = readReduceTargets(rows)
  const empty: ObjectivesRead = { behaviors: [], masteredNames: [], targets, found: false }
  if (targets.length < 2) return empty
  const statuses = readObjectivesStatus(rows)
  const descs = readDescriptionBlocks(rows)
  const behaviors: ObjectivesBehavior[] = []
  const masteredNames: string[] = []
  for (const t of targets) {
    const desc = descs.find((d) => objMatch(d.name, t))
    const st = statuses.find((s) => objMatch(s.name, t))
    // The reduce-target capsule is the canonical NAME (matches the plan's own list; avoids the LLM's expansion).
    if (st && st.status === 'mastered') { masteredNames.push(t); continue }
    behaviors.push({ name: t, status: 'active', topography: desc?.definition || '', baseline: desc?.baseline || '' })
  }
  const withDef = behaviors.filter((b) => b.topography).length
  // Credibility: need a real set, and most behaviors must carry a definition (else geometry didn't read this
  // format — fall through rather than emit definition-less behaviors that fail validation).
  if (behaviors.length < 2 || withDef < Math.ceil(behaviors.length * 0.5)) return empty
  return { behaviors, masteredNames, targets, found: true }
}
