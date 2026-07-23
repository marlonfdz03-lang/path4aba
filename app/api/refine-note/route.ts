import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { NOTE_PERFECTOR_PROMPT } from '@/app/prompts/notePerfectorPrompt';
import { prisma } from '@/lib/prisma';
import { filterBlockedNarrative, type BlockedTerm } from '@/lib/blockedNarrativeTerms';

export const runtime = 'nodejs';

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'azure-openai',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o`,
  defaultQuery: { 'api-version': '2025-01-01-preview' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },
});

function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

export async function POST(req: NextRequest) {
  try {
    const { originalNote, clientProfile, clientId, nextAppointmentDate, clinicalEvents } = await req.json();

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
        parts.push('', 'CLINICAL EVENTS THIS SESSION:', clinicalEvents.trim());
      }

      if (nextAppointmentDate) {
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

          let finalNote = refinedNote;
          let similarityWarning = false;
          const tooSimilar = previousTexts.length > 0 &&
            previousTexts.some(prev => calculateSimilarity(refinedNote, prev) > 0.55);

          if (tooSimilar) {
            controller.enqueue(encoder.encode('\n__REGEN__\n'));
            const variationHint = '\n\nIMPORTANT: The refined note is too similar to a previous session note for this client. You must significantly vary the sentence starters, narrative structure, intervention descriptions, and behavior topographies. The note must read as a distinctly different session.';
            const stream2 = await openai.chat.completions.create({
              model: 'gpt-4o', temperature: 0.7, max_tokens: 1500, stream: true,
              messages: [
                { role: 'system', content: NOTE_PERFECTOR_PROMPT },
                { role: 'user', content: userMessage(originalNote, variationHint) }
              ]
            });
            let regenNote = '';
            for await (const chunk of stream2) {
              const delta = chunk.choices[0]?.delta?.content || '';
              if (delta) { regenNote += delta; controller.enqueue(encoder.encode(delta)); }
            }
            finalNote = regenNote;
            similarityWarning = previousTexts.some(prev => calculateSimilarity(regenNote, prev) > 0.55);
          }

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
          controller.enqueue(encoder.encode(`\n__META__${JSON.stringify({ similarityWarning, blockedFlagged: flagged, filteredText: cleaned })}`));
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
