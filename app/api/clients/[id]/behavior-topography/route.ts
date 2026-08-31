import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessClient } from "@/lib/clientFiles";
import { filterBlockedNarrative } from "@/lib/blockedNarrativeTerms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const MAX_TOPOGRAPHY = 2000;
// Roster's shortest real operational definition is 81 chars; 30 sits well below it (never rejects a real one)
// while rejecting labels like "bad behavior" (12) / "aggressive behavior" (19).
const MIN_TOPOGRAPHY = 30;

// PATCH /api/clients/[id]/behavior-topography — a RBT/BCBA/admin ENTERS or CORRECTS one behavior's operational
// definition (topography) on the FAST tab. Mirrors behavior-functions exactly:
//  • ownership+admin gated (canAccessClient) — else 403, no read/write.
//  • the client sends only { behaviorName, topography }; the server finds the behavior and mutates ITS
//    topography, preserving every other key/behavior (never a client-sent whole-array overwrite).
//  • stored as a single-element `topographies` array — the shape behaviorMissingFields reads — so once entered
//    the behavior stops being incomplete and becomes selectable in the note form (no other change needed).
//  • marks the behavior human-edited (source + who + when), appends a topographyEdits audit entry, and
//    snapshots previousProfile so /profile/restore undoes it with no new undo code.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await canAccessClient(session, id)))
    return NextResponse.json({ error: "Forbidden — you are not assigned to this client." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const behaviorName = typeof body?.behaviorName === "string" ? body.behaviorName : "";
  if (!behaviorName.trim()) return NextResponse.json({ error: "behaviorName is required" }, { status: 400 });
  const topographyText = (typeof body?.topography === "string" ? body.topography : "").trim();
  if (!topographyText) return NextResponse.json({ error: "topography is required" }, { status: 400 });
  if (topographyText.length > MAX_TOPOGRAPHY)
    return NextResponse.json({ error: `topography is too long (max ${MAX_TOPOGRAPHY} characters)` }, { status: 400 });

  // OBSERVABILITY: an operational definition must be observable. Reuse the note blocked-narrative check and
  // REJECT (never silently rewrite) if ANY mentalistic term matched — the author must rephrase it themselves.
  // Both buckets count: `flagged` (no-substitute, e.g. "frustrated") AND `substituted` (e.g. "calm"→"quiet"),
  // because a definition must be written observably, not auto-swapped. Name EVERY match so it's one round trip.
  const { substituted, flagged } = filterBlockedNarrative(topographyText);
  const mentalistic = [...new Set([...substituted, ...flagged])];
  if (mentalistic.length) {
    const list = mentalistic.map((t) => `"${t}"`).join(", ");
    const verb = mentalistic.length === 1 ? "describes an inferred internal state" : "describe inferred internal states";
    return NextResponse.json({
      error: `An operational definition must be observable — ${list} ${verb}, not what the behavior looks like. Rephrase it as the observable, measurable actions you can see (e.g. "screams", "throws objects", "leaves the area"), then save again.`,
    }, { status: 400 });
  }

  // MINIMUM LENGTH: a label is not a definition.
  if (topographyText.length < MIN_TOPOGRAPHY)
    return NextResponse.json({
      error: `That's too short to be an operational definition. Describe what the behavior looks like — the observable, measurable actions the client does (e.g. "any instance the client hits others with an open hand") — not just a label.`,
    }, { status: 400 });

  const existing = await prisma.clients.findUnique({ where: { id }, select: { clinical_profile: true } });
  if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const profile: any = (existing.clinical_profile as any) || {};
  const behaviors: any[] = Array.isArray(profile.maladaptiveBehaviors) ? profile.maladaptiveBehaviors : [];
  const target = behaviors.find((b) => norm(typeof b === "string" ? b : b?.name || "") === norm(behaviorName));
  if (!target) return NextResponse.json({ error: "Behavior not found in this client's profile" }, { status: 404 });
  if (typeof target !== "object") return NextResponse.json({ error: "Behavior has no editable record" }, { status: 400 });

  const editedBy = (session.user as any).name || (session.user as any).email || (session.user as any).id;
  const editedById = (session.user as any).id;
  const editedAt = new Date().toISOString();
  const from = Array.isArray(target.topographies) ? target.topographies : (target.topography ? [target.topography] : []);
  const topographies = [topographyText];

  // Mutate ONLY the target behavior; preserve every other behavior + key.
  const updatedBehaviors = behaviors.map((b) =>
    b === target
      ? { ...b, topographies, topographySource: "human-edited", topographyEditedBy: editedBy, topographyEditedAt: editedAt }
      : b,
  );

  // Undo snapshot — strip any prior snapshot first so backups never nest (same semantics as behavior-functions).
  const { previousProfile: _stale, ...snapshot } = profile;
  const topographyEdits = [
    ...(Array.isArray(profile.topographyEdits) ? profile.topographyEdits : []),
    { behavior: target.name, from, to: topographies, editedBy, editedById, editedAt },
  ];
  const newProfile = { ...snapshot, maladaptiveBehaviors: updatedBehaviors, topographyEdits, previousProfile: snapshot };

  await prisma.clients.update({ where: { id }, data: { clinical_profile: newProfile } });
  return NextResponse.json({ ok: true, behavior: target.name, topographies, topographySource: "human-edited", editedBy, editedAt });
}
