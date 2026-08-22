"use client";

import { useEffect } from "react";
import { isChunkLoadError, shouldReloadForChunkError } from "@/lib/chunkReload";

// After every deploy, Next.js emits new JS chunks with new hashes. A browser tab still open from BEFORE the
// deploy references the OLD hashes, so its next client-side navigation tries to lazy-load a chunk that no
// longer exists → a "ChunkLoadError" / dispatch error the user sees as the app breaking. This has hit RBTs
// after every deploy; they had no reason to know a refresh fixes it.
//
// This handler catches that specific error (window 'error' + 'unhandledrejection') and reloads the page ONCE
// to pull fresh HTML pointing at the new chunk hashes — making the post-deploy blip invisible. It is guarded
// by a sessionStorage timestamp so a GENUINELY broken build (chunk error that persists after reload) does not
// reload forever: a second chunk error within the cooldown window is left to surface normally.
export function ChunkReloadHandler() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isChunkLoadError(e.error ?? e.message)) attemptReload();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) attemptReload();
    };
    const attemptReload = () => {
      let store: Storage | null = null;
      try { store = window.sessionStorage; } catch { store = null; }
      const now = Date.now();
      const last = store ? Number(store.getItem("chunkReloadAt") || 0) : 0;
      if (!shouldReloadForChunkError(now, last)) return; // cooldown → don't loop on a broken build
      try { store?.setItem("chunkReloadAt", String(now)); } catch { /* storage blocked; proceed once anyway */ }
      window.location.reload();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
