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
          // The note text is post-filtered for host-EHR-blocked terms (e.g. "sensory") inside
          // generateSmartNote, so we send the FILTERED result.note rather than the raw live deltas.
          // Only the regen control signal is forwarded live for UX (clients buffer before display).
          const result = await generateSmartNote(input, userId, (chunk) => {
            if (chunk.includes('__REGEN__')) controller.enqueue(encoder.encode('\n__REGEN__\n'));
          });
          controller.enqueue(encoder.encode(result.note));
          controller.enqueue(encoder.encode(
            `\n__META__${JSON.stringify({ similarityWarning: result.similarityWarning || false, blockedFlagged: result.blockedFlagged || [] })}`
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
