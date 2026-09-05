// Shared generation-history reader over session_notes. Read-only. Two consumers read the SAME rows and
// the SAME generation_context column: rotation (Commit 4) asks "what haven't we used lately, so rotate to
// something else in the locked set"; Stage-3 continuity asks "what's been running and how is it trending".
// Neither lives here — this module only turns rows into a structured, recency-ordered history. It NEVER
// selects a value and NEVER decides authorization; that is the selector's job (Commit 4), and the selector
// draws only from the locked sets, so nothing here can expand a set.
//
// KNOWN vs UNKNOWN is the load-bearing distinction. An axis is reported ONLY when the row actually recorded
// it. A legacy row (no generation_context) never stored activities_used, so its activities are UNKNOWN —
// left `undefined`, contributing NOTHING to the activity axis — NOT an empty list that would falsely read
// as "no activity was used" and make the rotation engine treat every activity as free. Same rule for any
// axis a legacy row cannot speak to.

import { segmentNoteByBehavior, deriveBehaviorFunction, functionToCanonical } from './functionPatterns.ts';
import { emitAdminAlert } from './adminAlerts.ts';

// What the preselector chose for one behavior/skill. Every field is optional: present iff KNOWN.
export interface AxisSelection {
  function?: string;
  antecedentKey?: string;
  interventionName?: string;
  // Teaching method — used on the perSkill side (a skill rotates its method, not a function/intervention).
  method?: string;
  promptKey?: string;
  responseKey?: string;
  activity?: string;
  // Topography the preselector assigned (so it can rotate across notes too). Additive: absent on legacy
  // rows and on Commit-3 notes; the reader passes it through verbatim from generation_context.
  topography?: string;
  // Outcome tier the compliance controller assigned (Commit 5) — carried so continuity can trend how a
  // client has been doing across recent notes.
  tier?: string;
}

export interface NoteContext {
  // 'generation_context' = authoritative (a Commit-4 note); 'derived' = reconstructed from note_text.
  source: 'generation_context' | 'derived';
  createdAt?: string;
  perBehavior: Record<string, AxisSelection>;
  perSkill: Record<string, AxisSelection>;
  // Note-level axes. `undefined` means UNKNOWN for this row (the save path that wrote it never stored the
  // axis) — the reader must not coerce that to an empty list. `interventions` IS stored by the legacy save
  // route (interventions_used); `activities` is NOT, so it is UNKNOWN for every legacy row.
  activities?: string[];
  interventions?: string[];
  behaviors?: string[];
  skills?: string[];
  // Note-level reinforcer axis. The reinforcers the note actually named (the preselector's top-3). KNOWN only
  // on an authoritative row — a legacy/derived row cannot reconstruct which reinforcer was named from prose,
  // so it stays undefined (contributes nothing), never an empty list that would read as "none used".
  reinforcers?: string[];
}

// The session_notes fields the reader needs (injected directly in tests; selected from prisma at runtime).
export interface SessionNoteRow {
  note_text?: string | null;
  behaviors_addressed?: string[] | null;
  skills_addressed?: string[] | null;
  interventions_used?: string[] | null;
  activities_used?: string[] | null;
  generation_context?: unknown;
  created_at?: Date | string | null;
}

const iso = (v: Date | string | null | undefined): string | undefined =>
  v == null ? undefined : (v instanceof Date ? v.toISOString() : String(v));

const asStringArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;

// A record<string, AxisSelection> defensively coerced from stored JSON.
function asSelectionMap(v: unknown): Record<string, AxisSelection> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, AxisSelection> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (raw && typeof raw === 'object') out[k] = raw as AxisSelection;
  }
  return out;
}

// Turn ONE session_notes row into a NoteContext. Pure — no DB, no I/O — so the KNOWN/UNKNOWN policy is
// unit-testable with injected rows.
export function buildNoteContext(row: SessionNoteRow): NoteContext {
  const gc = row.generation_context;

  // Authoritative path: a note the preselector wrote. Every axis it recorded is KNOWN.
  if (gc && typeof gc === 'object') {
    const g = gc as { perBehavior?: unknown; perSkill?: unknown; activities?: unknown; reinforcers?: unknown };
    const perBehavior = asSelectionMap(g.perBehavior);
    // Interventions the note used = the per-behavior interventionNames it chose (fall back to the stored
    // flat list only if the context carried none).
    const fromContext = Object.values(perBehavior)
      .map((s) => s.interventionName)
      .filter((x): x is string => typeof x === 'string');
    return {
      source: 'generation_context',
      createdAt: iso(row.created_at),
      perBehavior,
      perSkill: asSelectionMap(g.perSkill),
      activities: asStringArray(g.activities),
      interventions: fromContext.length ? [...new Set(fromContext)] : asStringArray(row.interventions_used),
      behaviors: asStringArray(row.behaviors_addressed),
      skills: asStringArray(row.skills_addressed),
      reinforcers: asStringArray(g.reinforcers),
    };
  }

  // Legacy path: no generation_context. Derive ONLY what the row can actually speak to.
  const behaviors = asStringArray(row.behaviors_addressed) ?? [];
  const perBehavior: Record<string, AxisSelection> = {};
  if (row.note_text && behaviors.length) {
    const segments = segmentNoteByBehavior(row.note_text, behaviors.map((name) => ({ name })));
    behaviors.forEach((name, i) => {
      // Normalize to the CANONICAL function (deriveBehaviorFunction returns a display label like "Escape";
      // a generation_context note stores canonical "escape"), so rotation compares across notes consistently.
      const fn = functionToCanonical(deriveBehaviorFunction(segments[i] ?? '', { name }).resolved);
      // Only the FUNCTION is reliably derivable from note text. antecedent/intervention/prompt/response/
      // activity per behavior are NOT — they stay absent (UNKNOWN), never guessed.
      if (fn) perBehavior[name] = { function: fn };
    });
  }

  return {
    source: 'derived',
    createdAt: iso(row.created_at),
    perBehavior,
    perSkill: {}, // legacy rows carry no per-skill selection to derive
    // activities: UNKNOWN. The legacy save route never persisted activities_used, so its value (empty or
    // not) is NOT evidence. Leave undefined so it contributes nothing to the activity axis.
    activities: undefined,
    // interventions IS persisted by the legacy save route, so it is KNOWN at the note level.
    interventions: asStringArray(row.interventions_used),
    behaviors,
    skills: asStringArray(row.skills_addressed) ?? [],
  };
}

// Map a set of rows (already newest-first) into recency-ordered history. Pure — the testable core of the
// reader.
export function mapRowsToHistory(rows: SessionNoteRow[]): NoteContext[] {
  return rows.map(buildNoteContext);
}

// A note CARRIES ROTATION SIGNAL when buildNoteContext can produce at least one usable axis from it:
// an authoritative generation_context, OR (derived) a per-behavior function, note-level interventions, or
// skills. A row with empty behaviors_addressed still counts if it has interventions_used or skills_addressed
// — those feed the intervention/skill axes. The extension save path stores note_text only, so its rows carry
// NO signal and must be skipped, not counted toward the window.
export function carriesRotationSignal(ctx: NoteContext): boolean {
  if (ctx.source === 'generation_context') return true;
  return (
    Object.keys(ctx.perBehavior).length > 0 ||
    (ctx.interventions?.length ?? 0) > 0 ||
    (ctx.skills?.length ?? 0) > 0
  );
}

// CLINICAL RECENCY BOUND — not a performance knob. Rotation is only meaningful against RECENT selections;
// rotating a client's axes against choices from more than ~20 sessions ago has no clinical value. So we look
// back at most this many notes to find `window` signal-bearing ones. A client whose last 20 notes all came
// through the extension (no stored signal) correctly yields a thin/empty window — there is genuinely nothing
// recent to rotate over — and that degradation is recorded (see below), never hidden.
const ROTATION_LOOKBACK = 20;

// Runtime entry point: the newest `window` SAVED notes that actually CARRY rotation signal, looking back over
// the last ROTATION_LOOKBACK notes so a run of signal-less extension rows doesn't starve rotation. A row
// exists in session_notes ONLY when the RBT saved (persistence is explicit-save-only), so this advances on
// save and never on a bare regeneration. `prisma` is injected so the pure mapping stays test-friendly; callers
// pass the app's client.
// `prisma` is typed loosely at this DB boundary (the real PrismaClient's generic findMany does not match a
// hand-written signature, and tests inject a mock). The select below fixes the shape we read.
export async function readGenerationHistory(
  prisma: { session_notes: { findMany: (args: any) => Promise<any[]> } },
  clientId: string,
  opts: { window?: number } = {},
): Promise<NoteContext[]> {
  const window = opts.window ?? 3;
  const rows: SessionNoteRow[] = await prisma.session_notes.findMany({
    // Active only (superseded_at IS NULL AND deleted_at IS NULL — the same predicate as
    // lib/sessionNotes.activeNotesWhere). Inlined rather than imported so this module stays prisma-free and
    // unit-testable with an injected client; a replaced OR deleted note must not count as "recently used" and
    // skew rotation.
    where: { client_id: clientId, superseded_at: null, deleted_at: null },
    orderBy: { created_at: 'desc' },
    take: ROTATION_LOOKBACK,
    select: {
      note_text: true,
      behaviors_addressed: true,
      skills_addressed: true,
      interventions_used: true,
      activities_used: true,
      generation_context: true,
      created_at: true,
    },
  });
  const signalRows = mapRowsToHistory(rows).filter(carriesRotationSignal);
  const historyWindow = signalRows.slice(0, window);

  // OBSERVABILITY (never blocks, never throws — emitAdminAlert is fail-soft by contract): if notes existed but
  // some carried no signal AND we still couldn't fill the window, the rotation is silently degraded. Record it
  // so the admin panel can see WHICH clients are affected. We only alert when rows were actually SKIPPED for
  // lack of signal (scanned > withSignal) — a genuinely new client with few notes is not a degradation.
  if (historyWindow.length < window && rows.length > signalRows.length) {
    await emitAdminAlert({
      source: 'note',
      type: 'note.rotation_window_degraded',
      severity: 'info',
      clientId,
      payload: { scanned: rows.length, withSignal: signalRows.length, window },
    });
  }

  return historyWindow;
}
