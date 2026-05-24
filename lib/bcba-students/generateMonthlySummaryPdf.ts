import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib'
import { BACB_RULES, type FieldworkType } from './calculations'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MonthlySummarySession {
  session_date: string
  start_time: string
  end_time: string
  total_hours: number
  activity_type: string
  contact_type: string
  supervisor_name: string | null
  session_note: string | null
}

export interface MonthlySummaryData {
  traineeName: string
  traineeBacbId: string | null
  supervisorName: string | null
  supervisorBacbId: string | null
  monthLabel: string        // e.g. "May 2026"
  monthYear: string         // e.g. "2026-05"
  fieldworkType: FieldworkType
  summary: {
    total_independent_hours: number
    total_supervised_hours: number
    total_hours: number
    supervision_pct: number
    unrestricted_hours: number
    restricted_hours: number
    supervisor_contacts: number
    individual_contacts: number
    group_contacts: number
    client_observations: number
    is_eligible: boolean
    ineligibility_reason: string | null
    mvf_signed: boolean
  }
  sessions: MonthlySummarySession[]
}

// ── Colors ────────────────────────────────────────────────────────────────────

const TEAL  = rgb(0.106, 0.659, 0.627)
const NAVY  = rgb(0.051, 0.169, 0.306)
const GRAY  = rgb(0.40,  0.40,  0.40)
const LGRAY = rgb(0.78,  0.78,  0.78)
const MGRAY = rgb(0.93,  0.93,  0.93)
const WHITE = rgb(1,     1,     1)
const GREEN = rgb(0.086, 0.627, 0.278)
const RED   = rgb(0.863, 0.196, 0.184)

// ── Helpers ───────────────────────────────────────────────────────────────────

function hRule(page: PDFPage, x1: number, x2: number, y: number, color = LGRAY, t = 0.75) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: t, color })
}

function txt(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, color = NAVY) {
  page.drawText(String(text), { x, y, size, font, color })
}

function truncate(s: string | null, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function formatTime(t: string) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`
}

const CONTACT_SHORT: Record<string, string> = {
  none:                  'Independent',
  individual_supervision:'Individual Sup.',
  group_supervision:     'Group Sup.',
  client_observation:    'Client Obs.',
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateMonthlySummaryPdf(data: MonthlySummaryData): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const reg  = await doc.embedFont(StandardFonts.Helvetica)

  const PW = 612, PH = 792
  const ML = 44, MR = PW - 44
  const W  = MR - ML

  const rules = BACB_RULES[data.fieldworkType]
  const s     = data.summary

  // ── Helper: new page ────────────────────────────────────────────────────────
  function addPage(): [PDFPage, number] {
    const page = doc.addPage([PW, PH])
    page.drawRectangle({ x: 0, y: PH - 36, width: PW, height: 36, color: NAVY })
    txt(page, bold, 'MONTHLY FIELDWORK SUMMARY', ML, PH - 24, 13, WHITE)
    const sub = `${data.monthLabel}  ·  ${data.fieldworkType === 'concentrated' ? 'Concentrated Supervised Fieldwork' : 'Supervised Fieldwork'}`
    txt(page, reg, sub, ML, PH - 34, 7.5, rgb(0.7, 0.85, 0.9))
    if (doc.getPageCount() > 1) {
      txt(page, reg, `${data.traineeName}  ·  continued`, MR - reg.widthOfTextAtSize(`${data.traineeName}  ·  continued`, 7.5), PH - 24, 7.5, rgb(0.7, 0.85, 0.9))
      return [page, PH - 52]
    }
    return [page, PH - 44]
  }

  let [page, y] = addPage()

  // ── INFO GRID ──────────────────────────────────────────────────────────────
  // 3-column layout: Supervisee | Supervisor | Month
  const colW = (W - 16) / 3
  const cols = [ML, ML + colW + 8, ML + (colW + 8) * 2]

  page.drawRectangle({ x: ML, y: y - 52, width: W, height: 56, color: MGRAY, borderColor: LGRAY, borderWidth: 0.5 })

  // Column 1: Supervisee
  txt(page, reg,  'SUPERVISEE', cols[0] + 8, y - 8, 6.5, GRAY)
  txt(page, bold, truncate(data.traineeName || '—', 28), cols[0] + 8, y - 20, 9, NAVY)
  txt(page, reg,  'BACB ID', cols[0] + 8, y - 33, 6.5, GRAY)
  txt(page, reg,  data.traineeBacbId || '—', cols[0] + 8, y - 43, 8.5, NAVY)

  // Vertical divider
  page.drawLine({ start: { x: cols[1] - 4, y: y - 52 }, end: { x: cols[1] - 4, y }, thickness: 0.5, color: LGRAY })

  // Column 2: Supervisor
  txt(page, reg,  'SUPERVISOR', cols[1] + 8, y - 8, 6.5, GRAY)
  txt(page, bold, truncate(data.supervisorName || '—', 28), cols[1] + 8, y - 20, 9, NAVY)
  txt(page, reg,  'BACB ID', cols[1] + 8, y - 33, 6.5, GRAY)
  txt(page, reg,  data.supervisorBacbId || '—', cols[1] + 8, y - 43, 8.5, NAVY)

  // Vertical divider
  page.drawLine({ start: { x: cols[2] - 4, y: y - 52 }, end: { x: cols[2] - 4, y }, thickness: 0.5, color: LGRAY })

  // Column 3: Month info
  txt(page, reg,  'MONTH', cols[2] + 8, y - 8, 6.5, GRAY)
  txt(page, bold, data.monthLabel, cols[2] + 8, y - 20, 9, NAVY)
  txt(page, reg,  'GENERATED', cols[2] + 8, y - 33, 6.5, GRAY)
  txt(page, reg,  new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), cols[2] + 8, y - 43, 8.5, NAVY)

  y -= 62

  // ── HOURS SUMMARY ─────────────────────────────────────────────────────────
  txt(page, bold, 'HOURS SUMMARY', ML, y, 8, GRAY)
  hRule(page, ML, MR, y - 2, TEAL, 1.5)
  y -= 14

  const boxW = (W - 12) / 4
  const boxes: Array<{ label: string; value: string }> = [
    { label: 'Total Hours',          value: s.total_hours.toFixed(2) },
    { label: 'Independent Hours',    value: s.total_independent_hours.toFixed(2) },
    { label: 'Supervised Hours',     value: s.total_supervised_hours.toFixed(2) },
    { label: '% Hours Supervised',   value: s.supervision_pct.toFixed(1) + '%' },
  ]
  for (let i = 0; i < boxes.length; i++) {
    const bx = ML + i * (boxW + 4)
    page.drawRectangle({ x: bx, y: y - 32, width: boxW, height: 36, color: MGRAY, borderColor: LGRAY, borderWidth: 0.5 })
    txt(page, reg,  boxes[i].label, bx + 6, y - 2,  7, GRAY)
    txt(page, bold, boxes[i].value, bx + 6, y - 21, 14, NAVY)
  }
  y -= 46

  // ── BACB REQUIREMENTS CHECKLIST ───────────────────────────────────────────
  txt(page, bold, 'BACB REQUIREMENTS CHECKLIST', ML, y, 8, GRAY)
  hRule(page, ML, MR, y - 2, TEAL, 1.5)
  y -= 14

  const grpPct = s.supervisor_contacts > 0 ? (s.group_contacts / s.supervisor_contacts) * 100 : 0

  // Section helper
  function sectionHeader(label: string) {
    txt(page, bold, label, ML + 4, y, 7.5, GRAY)
    y -= 12
  }

  function checkRow(label: string, met: boolean, detail: string) {
    const mark = met ? '✓' : '✗'
    txt(page, bold, mark,   ML + 12, y, 9, met ? GREEN : RED)
    txt(page, reg,  label,  ML + 26, y, 8.5, NAVY)
    txt(page, reg,  detail, ML + 290, y, 8, GRAY)
    y -= 13
  }

  // Total Hour Requirements
  sectionHeader('Total Hour Requirements')
  checkRow(
    'Minimum 20 Total Hours',
    s.total_hours >= 20,
    `${s.total_hours.toFixed(2)} hrs logged`
  )
  checkRow(
    'Maximum 130 Total Hours',
    s.total_hours <= 130,
    s.total_hours > 130 ? `${s.total_hours.toFixed(2)} hrs — exceeds limit` : `${s.total_hours.toFixed(2)} hrs — within limit`
  )
  y -= 4

  // Supervision Requirements
  sectionHeader('Supervision Requirements')
  const supMinPct = rules.supervisionPctMin
  checkRow(
    `Minimum ${supMinPct}% Supervision`,
    s.supervision_pct >= supMinPct,
    `${s.supervision_pct.toFixed(1)}% achieved`
  )
  checkRow(
    'Maximum 50% Group Supervision',
    s.supervisor_contacts === 0 || grpPct <= BACB_RULES.groupSupervisionMax,
    s.supervisor_contacts === 0 ? 'No contacts recorded' : `${grpPct.toFixed(0)}% group`
  )
  y -= 4

  // Contacts Requirements
  const contactsRequired = rules.contactsPerMonth
  sectionHeader('Contacts Requirements')
  checkRow(
    `Minimum ${contactsRequired} Total Contacts`,
    s.supervisor_contacts >= contactsRequired,
    `${s.supervisor_contacts} contact${s.supervisor_contacts !== 1 ? 's' : ''} recorded`
  )
  checkRow(
    'Minimum 1 Observation with Client',
    s.client_observations >= 1,
    `${s.client_observations} recorded`
  )
  y -= 4

  // Eligibility badge
  const badgeText = s.is_eligible ? '✓  ELIGIBLE FOR THIS MONTH' : '✗  INELIGIBLE FOR THIS MONTH'
  const badgeBg   = s.is_eligible ? rgb(0.9, 1.0, 0.94) : rgb(1.0, 0.93, 0.93)
  const badgeBdr  = s.is_eligible ? rgb(0.6, 0.9, 0.7)  : rgb(0.9, 0.7, 0.7)
  const badgeClr  = s.is_eligible ? GREEN : RED
  page.drawRectangle({ x: ML, y: y - 18, width: W, height: 22, color: badgeBg, borderColor: badgeBdr, borderWidth: 1 })
  txt(page, bold, badgeText, ML + 10, y - 7, 9, badgeClr)
  if (!s.is_eligible && s.ineligibility_reason) {
    txt(page, reg, s.ineligibility_reason, ML + 200, y - 7, 8, GRAY)
  }
  y -= 32

  // ── SESSION LOG TABLE ────────────────────────────────────────────────────
  y -= 6
  txt(page, bold, 'SESSION LOG', ML, y, 8, GRAY)
  hRule(page, ML, MR, y - 2, TEAL, 1.5)
  y -= 14

  // Column layout
  const COL = {
    date:    { x: ML,       w: 46  },
    start:   { x: ML + 46,  w: 42  },
    end:     { x: ML + 88,  w: 42  },
    hrs:     { x: ML + 130, w: 30  },
    act:     { x: ML + 160, w: 46  },
    contact: { x: ML + 206, w: 82  },
    sup:     { x: ML + 288, w: 72  },
    note:    { x: ML + 360, w: MR - (ML + 360) },
  }

  // Table header
  page.drawRectangle({ x: ML, y: y - 14, width: W, height: 17, color: NAVY })
  const headers: Array<{ label: string; x: number }> = [
    { label: 'Date',        x: COL.date.x + 3  },
    { label: 'Start',       x: COL.start.x + 3 },
    { label: 'End',         x: COL.end.x + 3   },
    { label: 'Hrs',         x: COL.hrs.x + 2   },
    { label: 'Activity',    x: COL.act.x + 2   },
    { label: 'Contact',     x: COL.contact.x + 2 },
    { label: 'Supervisor',  x: COL.sup.x + 2   },
    { label: 'Description', x: COL.note.x + 2  },
  ]
  for (const h of headers) txt(page, bold, h.label, h.x, y - 10, 7, WHITE)
  y -= 17

  let rowIndex = 0
  for (const sess of data.sessions) {
    const ROW_H = 13

    if (y < 60) {
      drawPageFooter(page, reg, ML, MR)
      ;[page, y] = addPage()
      page.drawRectangle({ x: ML, y: y - 14, width: W, height: 17, color: NAVY })
      for (const h of headers) txt(page, bold, h.label, h.x, y - 10, 7, WHITE)
      y -= 17
      rowIndex = 0
    }

    if (rowIndex % 2 === 0) {
      page.drawRectangle({ x: ML, y: y - ROW_H + 2, width: W, height: ROW_H, color: MGRAY })
    }

    const dateLabel    = new Date(sess.session_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const actLabel     = sess.activity_type === 'unrestricted' ? 'Unrest.' : 'Restr.'
    const contactLabel = CONTACT_SHORT[sess.contact_type] ?? sess.contact_type
    const noteLabel    = truncate(sess.session_note, 100)

    txt(page, reg, dateLabel,                          COL.date.x + 3,    y - 7.5, 7)
    txt(page, reg, formatTime(sess.start_time),        COL.start.x + 3,   y - 7.5, 7)
    txt(page, reg, formatTime(sess.end_time),          COL.end.x + 3,     y - 7.5, 7)
    txt(page, reg, sess.total_hours.toFixed(2),        COL.hrs.x + 2,     y - 7.5, 7)
    txt(page, reg, actLabel,                           COL.act.x + 2,     y - 7.5, 7)
    txt(page, reg, contactLabel,                       COL.contact.x + 2, y - 7.5, 7)
    txt(page, reg, truncate(sess.supervisor_name, 12), COL.sup.x + 2,     y - 7.5, 7)
    txt(page, reg, noteLabel,                          COL.note.x + 2,    y - 7.5, 6.5)

    y -= ROW_H
    rowIndex++
  }

  drawPageFooter(page, reg, ML, MR)

  return doc.save()
}

function drawPageFooter(page: PDFPage, font: PDFFont, ML: number, MR: number) {
  const PW   = page.getWidth()
  const yBase = 28
  page.drawLine({ start: { x: ML, y: yBase + 14 }, end: { x: MR, y: yBase + 14 }, thickness: 0.5, color: LGRAY })
  const line1 = 'Generated by Path4ABA — for reference only. Official M-FVF must be signed by supervisor.'
  const line2 = 'Both parties must retain a copy of all fieldwork documentation for at least 7 years.'
  const l1W = font.widthOfTextAtSize(line1, 6.5)
  const l2W = font.widthOfTextAtSize(line2, 6.5)
  page.drawText(line1, { x: (PW - l1W) / 2, y: yBase + 4, size: 6.5, font, color: GRAY })
  page.drawText(line2, { x: (PW - l2W) / 2, y: yBase - 6, size: 6.5, font, color: GRAY })
}
