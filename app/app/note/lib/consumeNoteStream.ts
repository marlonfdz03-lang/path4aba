// Reads the streamed text response from /api/generate-note. App-only helper — not imported by any website file.
//
// Option (a) presentation: pass-1 streams LIVE (onText per chunk). When the compliance coverage retry fires
// (__REGEN__), the display FREEZES — onText stops being called, so the RBT never watches the text erase and
// restart — onRegen fires once (the page dims the frozen text + shows a calm "Finalizing…" state), and pass-2
// accumulates invisibly. When the trailing __META__{...} completes, onText is called ONCE with the final text
// (the swap). The __META__ JSON is accumulated across reads before JSON.parse (fixes the null generation_context
// caused by parsing a chunk-split tail). Parsing lives in the shared, unit-tested splitNoteStream.

import { splitNoteStream } from "@/lib/noteStream";

// `blocking` separates "the note must not be used" (hide it, no summary tables, no saving) from an
// advisory the RBT should read alongside a note that is still usable. Absent/true = blocking, so an
// older server that only sends `error` keeps its current fail-safe behaviour.
export type NoteStreamMeta = { similarityWarning?: boolean; error?: string; blocking?: boolean; blockedFlagged?: string[]; coherenceFlags?: string[]; redFlags?: string[]; filteredText?: string; generationContext?: any; activitiesUsed?: string[] };

export type NoteStreamHandlers = {
  onText: (fullText: string) => void; // called as the note streams in (live for pass 1; once more at the end)
  onRegen: () => void;                // coverage retry — freeze the display, show the calm finalizing state
  onMeta: (meta: NoteStreamMeta) => void;
};

export async function consumeNoteStream(
  res: Response,
  handlers: NoteStreamHandlers,
): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let regenSignaled = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    const { note, metaRaw, sawRegen } = splitNoteStream(raw);

    if (sawRegen && !regenSignaled) { regenSignaled = true; handlers.onRegen(); }

    if (metaRaw === null) {
      // Still streaming. Pass 1 (no regen) streams live; once a regen has begun, FREEZE (do not call onText).
      if (!sawRegen) handlers.onText(note);
      continue;
    }

    // __META__ seen — accumulate until the JSON parses (it can span reads).
    try {
      const meta = JSON.parse(metaRaw) as NoteStreamMeta;
      handlers.onMeta(meta);
      const finalText = typeof meta.filteredText === "string" ? meta.filteredText : note;
      handlers.onText(finalText); // the single swap to the finished note
      return finalText;
    } catch {
      /* partial meta JSON — keep reading */
    }
  }

  // Stream ended without a parseable meta tail — reveal best-effort note text.
  const { note } = splitNoteStream(raw);
  handlers.onText(note);
  return note;
}
