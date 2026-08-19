import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { NOTE_PERFECTOR_PROMPT } from '@/app/prompts/notePerfectorPrompt';
import { prisma } from '@/lib/prisma';
import { filterBlockedNarrative, type BlockedTerm } from '@/lib/blockedNarrativeTerms';
import { findInterventionViolations } from '@/lib/interventionPolicy';
import { isValidNextSessionDate, stripInvalidNextSession, stripInvalidNextSessionSentence } from '@/lib/nextSessionDate';
import { findRedFlagFlags } from '@/lib/redFlagPhrases';
import { getExtensionAuth } from '@/lib/extensionAuth';
import { decideUniqueness } from '@/lib/noteSimilarity';

export const runtime = 'nodejs';

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2025-01-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
});

export async function POST(req: NextRequest) {
  try {
    // Authentication (Tier 1): this route previously had NO auth at all — an anonymous caller could POST
    // any clientId and read that client's last 10 session notes. Gate with getExtensionAuth() (NextAuth
    // session cookie OR extension Bearer token; the extension calls this route too and omits cookies) and
    // 401 when neither resolves a user. Authentication only — OWNERSHIP is STILL MISSING (Tier 2):
    // authedUser.id is available for an rbt_id / bcba_clients check on the clientId. Residual
    // (remediation #12): extension tokens have no expiry/rotation, so this gates on a long-lived credential.
    const authedUser = await getExtensionAuth();
    if (!authedUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { originalNote, clientProfile, clientId, nextAppointmentDate, clinicalEvents, sessionDate } = await req.json();

    if (!originalNote || originalNote.trim().length < 50) {
      return NextResponse.json({ error: 'Note is too short to refine' }, { status: 400 });
    }

    // Fetch previous notes for similarity check (only if clientId provided)
    let previousTexts: string[] = [];
    if (clientId) {
      const prevNotes = await prisma.session_notes.findMany({
        where: { client_id: clientId },
        select: { note_text: true },
        orderBy: { created_at: 'desc' },
        take: 10,
      });
      previousTexts = prevNotes.map(r => r.note_text).filter(Boolean) as string[];
    }

    const userMessage = (noteText: string, variationHint = ''): string => {
      const parts: string[] = [
        `Refine this ABA session note. Preserve all clinical facts. Apply all quality rules.${variationHint}`,
        '',
        'CLIENT PROFILE CONTEXT (use to ensure interventions match approved list):',
        `Approved interventions: ${clientProfile?.approvedInterventions?.join(', ') || 'DRA, DRI, FCT, NCR, Redirection, Behavior Momentum, Premack, Choices'}`,
        `Prohibited interventions: ${clientProfile?.prohibitedInterventions?.join(', ') || 'Punishment, ResponseCost, Restraint, TimeOut, Extinction'}`,
        `Reinforcers: ${JSON.stringify(clientProfile?.reinforcers || {})}`,
      ];

      const maladaptive: string[] = Array.isArray(clientProfile?.activePrograms?.maladaptive)
        ? clientProfile.activePrograms.maladaptive : [];
      if (maladaptive.length) {
        parts.push(`Maladaptive behaviors targeted: ${maladaptive.join(', ')}`);
      }

      const replacementSkills: string[] = Array.isArray(clientProfile?.activePrograms?.replacementSkills)
        ? clientProfile.activePrograms.replacementSkills : [];
      if (replacementSkills.length) {
        parts.push(`Replacement skills targeted: ${replacementSkills.join(', ')}`);
      }

      const continuitySummary: string | undefined = clientProfile?.continuityContext?.summary;
      if (continuitySummary) {
        parts.push('', `CONTINUITY CONTEXT: ${continuitySummary}`);
      }

      if (clinicalEvents && typeof clinicalEvents === 'string' && clinicalEvents.trim()) {
        // Drop any "Next scheduled appointment:" clause whose date is not strictly after the session date.
        const cleanedEvents = stripInvalidNextSession(clinicalEvents, sessionDate).trim();
        if (cleanedEvents) parts.push('', 'CLINICAL EVENTS THIS SESSION:', cleanedEvents);
      }

      // Only ask the refiner to add a next-session date when it is strictly AFTER the session date;
      // otherwise omit it entirely rather than let a past/equal date survive the rewrite.
      if (isValidNextSessionDate(nextAppointmentDate, sessionDate)) {
        parts.push('', `Next appointment: ${nextAppointmentDate} — mention this at the end of the note.`);
      }

      parts.push('', 'ORIGINAL NOTE TO REFINE:', noteText);

      return parts.join('\n');
    };

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // First pass
          const stream1 = await openai.chat.completions.create({
            model: 'gpt-4o', temperature: 0.3, max_tokens: 1500, stream: true,
            messages: [
              { role: 'system', content: NOTE_PERFECTOR_PROMPT },
              { role: 'user', content: userMessage(originalNote) }
            ]
          });
          // Stream raw tokens live for progressive display; filter at completion and send the
          // filtered text in __META__ so clients patch the displayed note.
          let refinedNote = '';
          for await (const chunk of stream1) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) { refinedNote += delta; controller.enqueue(encoder.encode(delta)); }
          }

          // UNIQUENESS — WARN, NEVER REGENERATE (Bug 6, Option C — mirrors generateSmartNote). Uniqueness
          // is cosmetic; after the note-language work made the function/opening/closing phrasing uniform by
          // clinical requirement, same-client notes legitimately share more vocabulary, so a
          // regenerate-on-similarity pass fired repeatedly and burned an extra gpt-4o call per refine. We
          // now surface a warning (like the coherence/red flags — surface, don't auto-rewrite) via the
          // shared 0.80-threshold helper, and never regenerate for it. The intervention COMPLIANCE gate
          // below is unaffected — it still regenerates once and errors on a persistent violation.
          // `finalNote` stays `let`: the intervention gate reassigns it on a compliance regen.
          let finalNote = refinedNote;
          const similarityWarning = previousTexts.length > 0
            ? decideUniqueness(refinedNote, previousTexts).warn
            : false;

          // TREATMENT-PLAN INTERVENTION GATE — a REFINED note may document ONLY interventions in the
          // client's approved plan, same compliance invariant as generation (interventionPolicy.ts).
          // The refiner is a second LLM pass that can reintroduce an out-of-plan procedure (its prompt
          // used to suggest RIRD), so it needs the same hard gate: prohibited (RIRD) always blocked,
          // closed-set check only when an approved list is present. On violation, regenerate once
          // naming it; if it still violates, surface an error instead of a note the RBT might sign.
          const approvedInterventions: string[] = Array.isArray(clientProfile?.approvedInterventions)
            ? clientProfile.approvedInterventions : [];
          // Role-awareness: same as generation — a skill (e.g. FCT) is valid as a skill being taught
          // but not as a reduction intervention unless it is also approved. Skill-blind here would make
          // FCT-as-skill false-fail on rewrite but pass on generation — a path-dependent gap.
          const skillPrograms: string[] = Array.isArray(clientProfile?.activePrograms?.replacementSkills)
            ? clientProfile.activePrograms.replacementSkills : [];
          let violations = findInterventionViolations(finalNote, approvedInterventions, skillPrograms);
          const violatingNames = () => [...new Set([...violations.prohibited, ...violations.unapproved, ...violations.skillAsReduction])];
          if (violatingNames().length > 0) {
            const bad = violatingNames();
            const roleNote = violations.skillAsReduction.length
              ? ` NOTE: ${violations.skillAsReduction.join(', ')} ${violations.skillAsReduction.length === 1 ? 'is a skill program' : 'are skill programs'}, not an approved reduction intervention — document ${violations.skillAsReduction.length === 1 ? 'it' : 'them'} ONLY as a skill being taught, never as a behavior-reduction intervention.`
              : '';
            controller.enqueue(encoder.encode('\n__REGEN__\n'));
            const violationHint = `\n\nCOMPLIANCE VIOLATION: the note you produced documented ${bad.join(', ')}, which ${bad.length === 1 ? 'is' : 'are'} NOT permitted as documented for this client.${roleNote} Rewrite the note using ONLY approved interventions, and NEVER mention response interruption and redirection (RIRD) or any intervention outside the approved list.`;
            const streamV = await openai.chat.completions.create({
              model: 'gpt-4o', temperature: 0.5, max_tokens: 1500, stream: true,
              messages: [
                { role: 'system', content: NOTE_PERFECTOR_PROMPT },
                { role: 'user', content: userMessage(originalNote, violationHint) }
              ]
            });
            let regenNote = '';
            for await (const chunk of streamV) {
              const delta = chunk.choices[0]?.delta?.content || '';
              if (delta) { regenNote += delta; controller.enqueue(encoder.encode(delta)); }
            }
            finalNote = regenNote;
            violations = findInterventionViolations(finalNote, approvedInterventions, skillPrograms);
            if (violatingNames().length > 0) {
              const still = violatingNames();
              controller.enqueue(encoder.encode(`\n__META__${JSON.stringify({ error: `Refined note repeatedly documented ${still.join(', ')}, which ${still.length === 1 ? 'is' : 'are'} not in this client's approved treatment plan. An RBT may only document approved interventions — please review the assessment or regenerate.` })}`));
              return;
            }
          }

          // Strip a "The next scheduled session is on <date>." closing sentence carried over from the
          // original note whose date is not strictly after the session date — so a wrong date the RBT
          // is one click from signing cannot survive the rewrite (the hole we closed on generation).
          finalNote = stripInvalidNextSessionSentence(finalNote, sessionDate);

          // Strip host-EHR-blocked narrative terms (e.g. "sensory"), merging any per-client terms
          // the extension learned from host validation messages.
          let learned: BlockedTerm[] = [];
          try {
            if (clientId) {
              const c = await prisma.clients.findUnique({ where: { id: clientId }, select: { clinical_profile: true } });
              const bt = (c?.clinical_profile as any)?.blockedNarrativeTerms;
              if (Array.isArray(bt)) {
                learned = bt
                  .map((t: any) => (typeof t === 'string' ? { term: t, substitute: null } : { term: t?.term, substitute: t?.substitute ?? null }))
                  .filter((t: BlockedTerm) => t.term);
              }
            }
          } catch { /* best-effort; seeded list still applies */ }
          const { text: cleaned, flagged } = filterBlockedNarrative(finalNote, learned);
          // Universal 97153 red-flag phrases surfaced for the RBT to rewrite (same as generation).
          const redFlags = findRedFlagFlags(cleaned);
          controller.enqueue(encoder.encode(`\n__META__${JSON.stringify({ similarityWarning, blockedFlagged: flagged, redFlags, filteredText: cleaned })}`));
        } catch (e) {
          controller.enqueue(encoder.encode(`\n__META__${JSON.stringify({ error: 'Stream error' })}`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

  } catch (error) {
    console.error('Note refinement error:', error);
    return NextResponse.json({ error: 'Failed to refine note' }, { status: 500 });
  }
}
