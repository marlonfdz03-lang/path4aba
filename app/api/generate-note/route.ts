import { NextRequest, NextResponse } from "next/server";
import { getExtensionAuth } from "@/lib/extensionAuth";
import { generateSmartNote, SessionInput } from "@/lib/generateSmartNote";
import { prisma } from "@/lib/prisma";
import { principalCanAccessClient } from "@/lib/clientFiles";
import { buildServerSessionInput, isSlimNoteRequest } from "@/lib/buildServerSessionInput";
import { emitAdminAlert } from "@/lib/adminAlerts";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();

    // DUAL-ACCEPT (extension migration window): a SLIM payload (session selections only) is built into a
    // full SessionInput server-side from the authoritative DB profile — so allowedFunctions /
    // matrixFunctions / approvedInterventions are DERIVED, never client-supplied, and every entry point
    // gets the same gates. A FAT SessionInput (legacy clients, e.g. an un-updated extension in the wild)
    // is still accepted verbatim so those users don't break; deprecate once adoption is confirmed.
    // AUTH FIRST — before any client fetch — then OWNERSHIP, then the profile fetch. This ordering also
    // closes the pre-auth client-existence leak: the slim path used to fetch the client (404 vs 200) BEFORE
    // authenticating, letting an unauthenticated caller probe which client ids exist. getExtensionAuth
    // accepts a NextAuth session cookie (web) OR an extension Bearer token.
    const authedUser = await getExtensionAuth();
    if (!authedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId: string = authedUser.id;

    const wasSlim = isSlimNoteRequest(body);
    const requestedClientId: string | undefined = (body as any)?.clientId;
    if (!requestedClientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    // Ownership gate (shared rule) BEFORE the profile is read — a non-owner never reaches the DB fetch.
    if (!(await principalCanAccessClient({ id: authedUser.id, role: authedUser.role }, requestedClientId))) {
      return NextResponse.json({ error: "You do not have access to this client." }, { status: 403 });
    }

    let input: SessionInput;
    if (wasSlim) {
      const client = await prisma.clients.findUnique({
        where: { id: requestedClientId },
        select: { clinical_profile: true, diagnosis: true },
      });
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }
      input = buildServerSessionInput(body, (client.clinical_profile as any) || {}, client.diagnosis);
    } else {
      input = body as SessionInput;
    }

    if (!input.clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    // FORM DEPENDENCY (server backstop, not UI-only): when something out of the ordinary was reported —
    // an environmental change or a medication change — the session cannot be "typical". The RBT must
    // actively pick below typical or poor. Checked on the slim payload's own flags; the copy reads as a
    // form prompt ("please indicate"), never a generation failure.
    if (wasSlim) {
      const b = body as { envChange?: unknown; medicationChange?: unknown; compliance?: unknown };
      const outOfOrdinary = !!(b.envChange || b.medicationChange);
      if (outOfOrdinary && b.compliance !== "below_typical" && b.compliance !== "poor") {
        return NextResponse.json(
          { error: "Something out of the ordinary was reported — please indicate the session's compliance level (below typical or poor)." },
          { status: 400 },
        );
      }
    }
    // AT LEAST ONE documented behavior. The note now writes one ABC per behavior the RBT marked, so
    // zero behaviors would ask for a note with no ABCs at all. Enforced here as well as in each
    // form, because a UI-only minimum is not a minimum.
    if (!input.behaviorsObserved?.length) {
      return NextResponse.json(
        { error: "Mark at least one behavior — a session note must document at least one behavior." },
        { status: 400 },
      );
    }
    if (!input.sessionInfo?.date) {
      // Shape-aware message. A slim payload sends `date` (+ selectedBehaviors[]); a full payload sends
      // sessionInfo.date. If the request carried a top-level `date` but we still have none, it was NOT
      // recognized as slim (routed as a full payload) — name that so a stale/hybrid client is obvious
      // rather than a misleading "sessionInfo.date is required".
      const b = body as { date?: unknown; selectedBehaviors?: unknown; behaviorsObserved?: unknown } | null;
      const hadTopLevelDate = !!b && typeof b.date === "string" && b.date.length > 0;
      const error = hadTopLevelDate && !wasSlim
        ? "Received `date` but the payload was not recognized as a slim request (needs selectedBehaviors[] and no behaviorsObserved). Update/reload the extension, or send sessionInfo.date for a full payload."
        : wasSlim
          ? "date is required"
          : "sessionInfo.date is required";
      return NextResponse.json({ error }, { status: 400 });
    }

    // (Auth + ownership already enforced at the top, before the profile fetch.) Extension tokens still have
    // no expiry/rotation (remediation #12), so this gates on a credential valid until revoked.
    const encoder = new TextEncoder();
    // Whether real note prose reached the client before a failure. A note that died before its first
    // token and one that died mid-paragraph are different incidents (the second usually means the
    // model or a gate failed partway, the first that setup did), and the failure alert below cannot
    // tell them apart after the fact — so it is recorded as it happens.
    let emittedContent = false;
    // Whether the combined compliance gate fired its one regeneration. generateSmartNote signals it
    // through the SAME onChunk callback as prose, so the two must be counted separately: a note that
    // regenerated and then died before writing any prose had emitted nothing the RBT could see.
    let regenFired = false;
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Stream raw tokens live for progressive display. The note is post-filtered for
          // host-EHR-blocked terms (e.g. "sensory") inside generateSmartNote (and saved filtered),
          // so we ALSO send the FILTERED final text in __META__ — clients patch the displayed note
          // at completion, so nothing unfiltered reaches the fill even though the live stream is raw.
          const result = await generateSmartNote(input, userId, (text) => {
            // __REGEN__ is a control marker, not note text. Stripping it (with its framing newlines)
            // leaves exactly the prose this chunk carried: if anything is left the RBT saw output, and
            // if the strip changed the chunk at all the regeneration fired. generateSmartNote sends the
            // marker as its own chunk today; handling a mixed chunk keeps that from becoming a
            // correctness dependency.
            const prose = text.replace(/\n?__REGEN__\n?/g, '');
            if (prose !== text) regenFired = true;
            if (prose.length > 0) emittedContent = true;
            controller.enqueue(encoder.encode(text));
          });
          controller.enqueue(encoder.encode(
            // generationContext + activitiesUsed flow to the client so it can persist them on save (the
            // rotation/continuity history the next note reads).
            `\n__META__${JSON.stringify({ similarityWarning: result.similarityWarning || false, blockedFlagged: result.blockedFlagged || [], coherenceFlags: result.coherenceFlags || [], redFlags: result.redFlags || [], generationContext: result.generationContext || null, activitiesUsed: result.generationContext?.activities || [], filteredText: result.note })}`
          ));
        } catch (e: any) {
          // This path previously produced NO server-side record of any kind — the error was
          // serialized to the client and discarded. It is the only path an RBT can hit that costs
          // them their note, so it now logs and raises an admin alert. Both are ADDITIVE: the
          // __META__ frame below is byte-for-byte what it was, and the client behavior is unchanged.
          console.error('[generate-note] generation failed', {
            clientId: input.clientId,
            userId,
            emittedContent,
            regenFired,
            error: e?.message || String(e),
          }, e);
          // Started BEFORE the enqueue so a client that has already disconnected (which makes
          // enqueue throw) still produces the alert, and awaited AFTER it so the client sees the
          // error at exactly the same moment it always did. emitAdminAlert never throws, so it can
          // neither break this catch nor the close() in `finally`; awaiting it means the write is
          // not cut short when the serverless function freezes.
          const alerted = emitAdminAlert({
            source: 'note',
            type: 'note.generation_failed',
            severity: 'critical',
            actorUserId: userId,
            clientId: input.clientId,
            payload: {
              message: e?.message || String(e),
              name: e?.name || null,
              stack: e?.stack || null,
              // True = the RBT watched a partial note appear and then fail.
              emittedContent,
              // True = the gate had already spent its one regeneration before the failure.
              regenFired,
            },
          });
          // BLOCKING: the note must not be used (a compliance hard-stop, or generation failed
          // outright). Clients hide the note, skip the session-summary tables, and disable saving.
          // An advisory message would carry `blocking: false` and leave both in place — the point of
          // the flag is that "there is a message" no longer means "throw the whole result away".
          controller.enqueue(encoder.encode(
            `\n__META__${JSON.stringify({ error: e.message || 'Generation failed', blocking: true })}`
          ));
          await alerted;
        } finally {
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error: any) {
    console.error("Note generation error:", error);
    return NextResponse.json(
      { error: "Note generation failed", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
