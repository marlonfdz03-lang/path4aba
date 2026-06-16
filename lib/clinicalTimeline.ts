import { prisma } from '@/lib/prisma'

export type TimelineEntryType =
  | 'monthly_progress_report'
  | 'reassessment_summary'
  | 'assessment_uploaded'
  | 'assessment_updated'
  | 'protocol_modification'
  | 'medical_necessity_letter'
  | 'authorization_approved'
  | 'authorization_denied'
  | 'hours_increased'
  | 'hours_reduced'
  | 'parent_training'

export type TimelineImportance = 'low' | 'medium' | 'high' | 'critical'

const IMPORTANCE_MAP: Record<TimelineEntryType, TimelineImportance> = {
  monthly_progress_report:  'medium',
  reassessment_summary:     'high',
  assessment_uploaded:      'high',
  assessment_updated:       'high',
  protocol_modification:    'high',
  medical_necessity_letter: 'high',
  authorization_approved:   'critical',
  authorization_denied:     'critical',
  hours_increased:          'critical',
  hours_reduced:            'critical',
  parent_training:          'low',
}

export async function createClinicalTimelineEntry({
  clientId,
  date,
  type,
  title,
  summary,
  metadata,
  createdBy,
  source,
}: {
  clientId: string
  date: string
  type: TimelineEntryType
  title: string
  summary?: string
  metadata?: Record<string, any>
  createdBy?: string
  source?: string
}) {
  try {
    await prisma.clinical_timeline_entries.upsert({
      where: {
        client_id_type_title: {
          client_id: clientId,
          type,
          title,
        },
      },
      update: {
        date,
        summary: summary ?? undefined,
        metadata: metadata ?? undefined,
        created_by: createdBy ?? undefined,
        source: source ?? undefined,
        importance: IMPORTANCE_MAP[type as TimelineEntryType] || 'medium',
      },
      create: {
        client_id: clientId,
        date,
        type,
        title,
        summary: summary ?? undefined,
        metadata: metadata ?? undefined,
        created_by: createdBy ?? undefined,
        source: source ?? undefined,
        importance: IMPORTANCE_MAP[type as TimelineEntryType] || 'medium',
      },
    })
  } catch (err) {
    console.error('[clinicalTimeline] Failed to create entry:', err)
  }
}
