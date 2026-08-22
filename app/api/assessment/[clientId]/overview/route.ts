import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessClient } from "@/lib/clientFiles";
import { computeAssessmentStatus } from "@/lib/assessmentStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/assessment/[clientId]/overview — the Assessment Builder's section-by-section status dashboard.
// Ownership/admin gated (canAccessClient). PURE, DETERMINISTIC status computed server-side from the stored
// clinical_profile (computeAssessmentStatus) — no LLM, no clinical judgment. Read-only; changes nothing.
// Built against the CURRENT clinical_profile shape; when the Builder's section structure is approved this
// swaps to a draft-assessment source without changing the status logic.
export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clientId } = await params;
  if (!(await canAccessClient(session, clientId)))
    return NextResponse.json({ error: "Forbidden — you are not assigned to this client." }, { status: 403 });

  const client = await prisma.clients.findUnique({ where: { id: clientId }, select: { clinical_profile: true } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const profile = (client.clinical_profile as any) || {};
  const status = computeAssessmentStatus(profile);
  return NextResponse.json(status);
}
