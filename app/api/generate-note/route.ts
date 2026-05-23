import { NextRequest, NextResponse } from "next/server";
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

    const result = await generateSmartNote(input);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Note generation error:", error);

    return NextResponse.json(
      {
        error: "Note generation failed",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
