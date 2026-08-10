import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessClient } from "@/lib/clientFiles";

export const runtime = "nodejs";

// ONE-LEVEL UNDO for the Update-Assessment full-refresh.
//
// The refresh (app/api/extract-assessment) snapshots the pre-refresh clinical_profile as
// `clinical_profile.previousProfile`. Before this route existed, that snapshot was WRITTEN BUT NEVER READ
// — a "backup" nothing could restore, i.e. false safety. This restores it, which is the mitigation for
// the guard's presence-not-correctness limitation: a plausible-but-wrong extraction that passes GUARD 1
// and overwrites a real profile is now recoverable in-app instead of needing manual DB surgery.
//
// Ownership-gated (canAccessClient): the RBT of the client, a connected BCBA, or an admin — the SAME gate
// now shared by every client route (the security fix + behavior-functions). One level only: the snapshot was
// stored WITHOUT its own previousProfile, so restoring clears the undo slot — no redo, no compounding.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await canAccessClient(session, id))) {
    return NextResponse.json(
      { error: "Forbidden — you are not assigned to this client." },
      { status: 403 }
    );
  }

  const existing = await prisma.clients.findUnique({
    where: { id },
    select: { clinical_profile: true },
  });
  if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const profile = (existing.clinical_profile as any) || {};
  const snapshot = profile.previousProfile;
  if (!snapshot || typeof snapshot !== "object") {
    return NextResponse.json(
      { error: "No previous assessment to restore — there is nothing to undo." },
      { status: 409 }
    );
  }

  // Restore the snapshot as the live profile. It was stored sans its own previousProfile, so this clears
  // the undo slot (defensive strip in case a snapshot ever carried one). One level only.
  const { previousProfile: _drop, ...restored } = snapshot;
  await prisma.clients.update({
    where: { id },
    data: { clinical_profile: restored },
  });

  return NextResponse.json({ ...restored, restored: true });
}
