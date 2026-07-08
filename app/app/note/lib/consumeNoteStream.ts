// Reads the streamed text response from /api/generate-note (or /api/refine-note),
// parsing the inline __REGEN__ marker (clear & restart) and the trailing
// __META__{...} JSON tail. App-only helper — not imported by any website file.

export type NoteStreamMeta = { similarityWarning?: boolean; error?: string };

export type NoteStreamHandlers = {
  onText: (fullText: string) => void; // called as the note streams in
  onRegen: () => void;                // note was too similar; stream restarts
  onMeta: (meta: NoteStreamMeta) => void;
};

export async function consumeNoteStream(
  res: Response,
  handlers: NoteStreamHandlers,
): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });

    if (chunk.includes("__META__")) {
      const parts = chunk.split("__META__");
      if (parts[0]) {
        fullText += parts[0];
        handlers.onText(fullText);
      }
      try {
        handlers.onMeta(JSON.parse(parts[1]) as NoteStreamMeta);
      } catch {
        /* malformed meta — ignore */
      }
      break;
    }

    if (chunk.includes("__REGEN__")) {
      fullText = "";
      handlers.onRegen();
      continue;
    }

    fullText += chunk;
    handlers.onText(fullText);
  }

  return fullText;
}
