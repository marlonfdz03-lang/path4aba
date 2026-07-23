import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
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

    const session = await auth();
    const userId = (session?.user as any)?.id as string | undefined;

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
