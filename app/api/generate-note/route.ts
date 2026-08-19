import { NextRequest, NextResponse } from "next/server";
import { getExtensionAuth } from "@/lib/extensionAuth";
import { generateSmartNote, SessionInput } from "@/lib/generateSmartNote";
import { prisma } from "@/lib/prisma";
import { buildServerSessionInput, isSlimNoteRequest } from "@/lib/buildServerSessionInput";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();

    // DUAL-ACCEPT (extension migration window): a SLIM payload (session selections only) is built into a
    // full SessionInput server-side from the authoritative DB profile — so allowedFunctions /
    // matrixFunctions / approvedInterventions are DERIVED, never client-supplied, and every entry point
    // gets the same gates. A FAT SessionInput (legacy clients, e.g. an un-updated extension in the wild)
    // is still accepted verbatim so those users don't break; deprecate once adoption is confirmed.
    const wasSlim = isSlimNoteRequest(body);
    let input: SessionInput;
    if (wasSlim) {
      if (!body.clientId) {
        return NextResponse.json({ error: "clientId is required" }, { status: 400 });
      }
      const client = await prisma.clients.findUnique({
        where: { id: body.clientId },
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

    // Authentication (Tier 1): accept a NextAuth session cookie (web) OR an extension Bearer token,
    // and 401 when neither resolves a user — this closes the anonymous-read hole (the route previously
    // called auth() and discarded the result). getExtensionAuth returns the user IDENTITY, so Tier 2 can
    // add an rbt_id / bcba_clients OWNERSHIP check on authedUser.id — which is STILL MISSING here: any
    // authenticated user can currently still generate a note for any clientId. Residual (remediation #12):
    // extension tokens have no expiry/rotation, so this gates on a credential valid until revoked.
    const authedUser = await getExtensionAuth();
    if (!authedUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId: string = authedUser.id;

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Stream raw tokens live for progressive display. The note is post-filtered for
          // host-EHR-blocked terms (e.g. "sensory") inside generateSmartNote (and saved filtered),
          // so we ALSO send the FILTERED final text in __META__ — clients patch the displayed note
          // at completion, so nothing unfiltered reaches the fill even though the live stream is raw.
          const result = await generateSmartNote(input, userId, (text) => {
            controller.enqueue(encoder.encode(text));
          });
          controller.enqueue(encoder.encode(
            // DIAGNOSTIC (temporary — 2x-regen trace): firstTryDefects + buildTag surfaced so a generate
            // proves the running bundle and the dominant first-try defect. Remove with the other diag hooks.
            `\n__META__${JSON.stringify({ similarityWarning: result.similarityWarning || false, blockedFlagged: result.blockedFlagged || [], coherenceFlags: result.coherenceFlags || [], redFlags: result.redFlags || [], firstTryDefects: result.firstTryDefects || [], buildTag: result.buildTag || 'unknown', filteredText: result.note })}`
          ));
        } catch (e: any) {
          // BLOCKING: the note must not be used (a compliance hard-stop, or generation failed
          // outright). Clients hide the note, skip the session-summary tables, and disable saving.
          // An advisory message would carry `blocking: false` and leave both in place — the point of
          // the flag is that "there is a message" no longer means "throw the whole result away".
          controller.enqueue(encoder.encode(
            `\n__META__${JSON.stringify({ error: e.message || 'Generation failed', blocking: true })}`
          ));
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
