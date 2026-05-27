import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { generateSmartNote, SessionInput } from "@/lib/generateSmartNote";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const input: SessionInput = await req.json();

    if (!input.clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 }
      );
    }

    if (!input.sessionInfo?.date) {
      return NextResponse.json(
        { error: "sessionInfo.date is required" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    );
    const { data: { user } } = await authClient.auth.getUser();

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const result = await generateSmartNote(input, user?.id, (text) => {
            controller.enqueue(encoder.encode(text));
          });
          controller.enqueue(encoder.encode(
            `\n__META__${JSON.stringify({ similarityWarning: result.similarityWarning || false })}`
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
