// Pure logic for the post-deploy chunk-reload handler (see app/components/ChunkReloadHandler.tsx). Split out so
// it is unit-testable without a DOM.

// Detect the specific error a stale browser tab throws when it tries to lazy-load a JS/CSS chunk whose hash
// no longer exists after a deploy. Matches the standard shapes across bundlers/browsers. Deliberately NARROW
// — only chunk-loading failures, never generic errors (we must not reload the page on ordinary runtime errors).
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const name = String((err as any)?.name ?? "");
  if (name === "ChunkLoadError") return true;
  const msg = String((err as any)?.message ?? err ?? "");
  return (
    /ChunkLoadError/i.test(msg) ||
    /Loading( CSS)? chunk [\w-]+ failed/i.test(msg) ||          // webpack
    /Failed to fetch dynamically imported module/i.test(msg) || // native ESM / Vite-style
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)               // Safari
  );
}

// Cooldown guard: reload at most once per COOLDOWN window. `last` is the last reload timestamp (0 if never).
// A stale-chunk error is fixed by one reload (no further error fires). A GENUINELY broken build throws again
// immediately on reload — within the cooldown — so we return false and let it surface instead of looping.
export const CHUNK_RELOAD_COOLDOWN_MS = 10_000;

export function shouldReloadForChunkError(now: number, last: number): boolean {
  if (!Number.isFinite(now)) return false;
  if (!last) return true;                       // never reloaded → reload
  return now - last >= CHUNK_RELOAD_COOLDOWN_MS; // outside cooldown (e.g. a later deploy) → reload again
}
