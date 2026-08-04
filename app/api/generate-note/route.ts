import { NextRequest, NextResponse } from "next/server";
import { getExtensionAuth } from "@/lib/extensionAuth";
import { generateSmartNote, SessionInput } from "@/lib/generateSmartNote";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const input: SessionInput = await req.json();

    if (!input.clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    if (!input.sessionInfo?.date) {
      return NextResponse.json({ error: "sessionInfo.date is required" }, { status: 400 });
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
            `\n__META__${JSON.stringify({ similarityWarning: result.similarityWarning || false, blockedFlagged: result.blockedFlagged || [], coherenceFlags: result.coherenceFlags || [], filteredText: result.note })}`
          ));
        } catch (e: any) {
          controller.enqueue(encoder.encode(
            `\n__META__${JSON.stringify({ error: e.message || 'Generation failed' })}`
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
