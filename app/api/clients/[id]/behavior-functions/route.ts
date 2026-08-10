import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessClient } from "@/lib/clientFiles";
import { normalizeApprovedFunctions } from "@/lib/functionPatterns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// PATCH /api/clients/[id]/behavior-functions — a RBT/BCBA/admin corrects ONE behavior's functions on the FAST
// tab. Clinical write, so it is tightly scoped:
//  • ownership+admin gated (canAccessClient) — else 403, no read/write.
//  • FIREWALL: the submitted functions are re-validated through normalizeApprovedFunctions, which drops
//    anything not in the canonical set (attention/escape/tangible/automatic). A crafted request with a bogus
//    function stores nothing invented — the server, not the UI, is the enforcement point.
//  • the client sends only { behaviorName, functions } — the server finds the behavior and mutates ITS
//    functions, preserving every other key/behavior (never a client-sent whole-array overwrite).
//  • marks the behavior human-edited (source + who + when), appends an audit entry, and snapshots
//    previousProfile so /profile/restore undoes the edit with no new undo code.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await canAccessClient(session, id)))
    return NextResponse.json({ error: "Forbidden — you are not assigned to this client." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const behaviorName = typeof body?.behaviorName === "string" ? body.behaviorName : "";
  if (!behaviorName.trim()) return NextResponse.json({ error: "behaviorName is required" }, { status: 400 });

  // FIREWALL: canonical-only. Non-canonical / invented values are dropped here, server-side.
  const functions = [...normalizeApprovedFunctions(Array.isArray(body?.functions) ? body.functions : [])];

  const existing = await prisma.clients.findUnique({ where: { id }, select: { clinical_profile: true } });
  if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const profile: any = (existing.clinical_profile as any) || {};
  const behaviors: any[] = Array.isArray(profile.maladaptiveBehaviors) ? profile.maladaptiveBehaviors : [];
  const target = behaviors.find((b) => norm(typeof b === "string" ? b : b?.name || "") === norm(behaviorName));
  if (!target) return NextResponse.json({ error: "Behavior not found in this client's profile" }, { status: 404 });

  const editedBy = (session.user as any).name || (session.user as any).email || (session.user as any).id;
  const editedById = (session.user as any).id;
  const editedAt = new Date().toISOString();
  const from = Array.isArray(target.functions) ? target.functions : [];

  // Mutate ONLY the target behavior; preserve every other behavior + key.
  const updatedBehaviors = behaviors.map((b) =>
    b === target
      ? { ...b, functions, functionsSource: "human-edited", functionsEditedBy: editedBy, functionsEditedAt: editedAt }
      : b,
  );

  // Undo snapshot — strip any prior snapshot first so backups never nest (same semantics as buildRefreshedProfile).
  const { previousProfile: _stale, ...snapshot } = profile;
  const functionEdits = [
    ...(Array.isArray(profile.functionEdits) ? profile.functionEdits : []),
    { behavior: target.name, from, to: functions, editedBy, editedById, editedAt },
  ];
  const newProfile = { ...snapshot, maladaptiveBehaviors: updatedBehaviors, functionEdits, previousProfile: snapshot };

  await prisma.clients.update({ where: { id }, data: { clinical_profile: newProfile } });
  return NextResponse.json({ ok: true, behavior: target.name, functions, functionsSource: "human-edited", editedBy, editedAt });
}
