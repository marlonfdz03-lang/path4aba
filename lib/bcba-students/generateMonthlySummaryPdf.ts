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

  // ── Helper: new page with header ────────────────────────────────────────────
  function addPage(): [PDFPage, number] {
    const page = doc.addPage([PW, PH])
    // teal accent bar
    page.drawRectangle({ x: ML, y: PH - 42, width: W, height: 4, color: TEAL })
    // page header (continuation pages only show a compact header)
    if (doc.getPageCount() > 1) {
      txt(page, bold, 'MONTHLY FIELDWORK SUMMARY (continued)', ML, PH - 56, 9, NAVY)
      txt(page, reg,  `${data.traineeName}  ·  ${data.monthLabel}`, ML, PH - 68, 8, GRAY)
      return [page, PH - 84]
    }
    return [page, PH - 46]
  }

  let [page, y] = addPage()

  // ── TITLE ──────────────────────────────────────────────────────────────────
  const title = 'MONTHLY FIELDWORK SUMMARY'
  const titleW = bold.widthOfTextAtSize(title, 17)
  txt(page, bold, title, (PW - titleW) / 2, y, 17, NAVY)
  y -= 16

  const sub = `${data.monthLabel}  ·  ${data.fieldworkType === 'concentrated' ? 'Concentrated Fieldwork' : 'Supervised Fieldwork'}`
  const subW = reg.widthOfTextAtSize(sub, 10)
  txt(page, reg, sub, (PW - subW) / 2, y, 10, TEAL)
  y -= 8

  hRule(page, ML, MR, y, LGRAY, 1)
  y -= 18

  // ── TRAINEE INFO ──────────────────────────────────────────────────────────
  txt(page, reg,  'TRAINEE', ML, y, 7.5, GRAY)
  txt(page, reg,  'MONTH', ML + 260, y, 7.5, GRAY)
  txt(page, reg,  'GENERATED', ML + 380, y, 7.5, GRAY)
  y -= 13
  txt(page, bold, data.traineeName || '—', ML, y, 11, NAVY)
  txt(page, bold, data.monthLabel, ML + 260, y, 11, NAVY)
  txt(page, reg,  new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), ML + 380, y, 9, GRAY)
  y -= 22

  hRule(page, ML, MR, y, LGRAY, 0.5)
  y -= 14

  // ── SUMMARY METRICS ───────────────────────────────────────────────────────
  txt(page, bold, 'HOURS SUMMARY', ML, y, 8, GRAY)
  hRule(page, ML, MR, y - 2, TEAL, 1.5)
  y -= 14

  // 4-column metric boxes
  const boxW = (W - 12) / 4
  const boxes: Array<{ label: string; value: string }> = [
    { label: 'Independent Hrs', value: s.total_independent_hours.toFixed(2) },
    { label: 'Supervised Hrs',  value: s.total_supervised_hours.toFixed(2) },
    { label: 'Total Hrs',       value: s.total_hours.toFixed(2) },
    { label: 'Supervision %',   value: s.supervision_pct.toFixed(1) + '%' },
  ]
  for (let i = 0; i < boxes.length; i++) {
    const bx = ML + i * (boxW + 4)
    page.drawRectangle({ x: bx, y: y - 30, width: boxW, height: 34, color: MGRAY, borderColor: LGRAY, borderWidth: 0.5 })
    txt(page, reg,  boxes[i].label, bx + 6, y + 0, 7, GRAY)
    txt(page, bold, boxes[i].value, bx + 6, y - 18, 13, NAVY)
  }
  y -= 44

  // 2nd row: contacts
  const boxes2: Array<{ label: string; value: string }> = [
    { label: 'Sup. Contacts',   value: String(s.supervisor_contacts) },
    { label: 'Individual Sup.', value: String(s.individual_contacts) },
    { label: 'Group Sup.',      value: String(s.group_contacts) },
    { label: 'Client Obs.',     value: String(s.client_observations) },
  ]
  for (let i = 0; i < boxes2.length; i++) {
    const bx = ML + i * (boxW + 4)
    page.drawRectangle({ x: bx, y: y - 30, width: boxW, height: 34, color: MGRAY, borderColor: LGRAY, borderWidth: 0.5 })
    txt(page, reg,  boxes2[i].label, bx + 6, y + 0, 7, GRAY)
    txt(page, bold, boxes2[i].value, bx + 6, y - 18, 13, NAVY)
  }
  y -= 50

  // ── COMPLIANCE STATUS ────────────────────────────────────────────────────
  txt(page, bold, 'COMPLIANCE STATUS', ML, y, 8, GRAY)
  hRule(page, ML, MR, y - 2, TEAL, 1.5)
  y -= 14

  const indivPct = s.supervisor_contacts > 0 ? (s.individual_contacts / s.supervisor_contacts) * 100 : 0
  const grpPct   = s.supervisor_contacts > 0 ? (s.group_contacts   / s.supervisor_contacts) * 100 : 0

  const checks: Array<{ label: string; met: boolean; detail: string }> = [
    {
      label: 'Minimum hours per month',
      met:   s.total_hours >= rules.minHoursPerMonth,
      detail: `${s.total_hours.toFixed(2)} of ${rules.minHoursPerMonth} hrs required`,
    },
    {
      label: `Minimum supervision % (${rules.supervisionPctMin}%)`,
      met:   s.supervision_pct >= rules.supervisionPctMin,
      detail: `${s.supervision_pct.toFixed(1)}% achieved`,
    },
    {
      label: `Supervision contacts per month (${rules.contactsPerMonth} required)`,
      met:   s.supervisor_contacts >= rules.contactsPerMonth,
      detail: `${s.supervisor_contacts} contact${s.supervisor_contacts !== 1 ? 's' : ''} recorded`,
    },
    {
      label: 'Client observation (≥1 required)',
      met:   s.client_observations >= BACB_RULES.clientObservationsPerMonth,
      detail: `${s.client_observations} recorded`,
    },
    {
      label: `Individual supervision ≥${BACB_RULES.individualSupervisionMin}% of contacts`,
      met:   s.supervisor_contacts === 0 || indivPct >= BACB_RULES.individualSupervisionMin,
      detail: s.supervisor_contacts === 0 ? 'No contacts recorded' : `${indivPct.toFixed(0)}% individual`,
    },
    {
      label: `Group supervision ≤${BACB_RULES.groupSupervisionMax}% of contacts`,
      met:   s.supervisor_contacts === 0 || grpPct <= BACB_RULES.groupSupervisionMax,
      detail: s.supervisor_contacts === 0 ? 'No contacts recorded' : `${grpPct.toFixed(0)}% group`,
    },
    {
      label: 'M-FVF signed by supervisor',
      met:   s.mvf_signed,
      detail: s.mvf_signed ? 'Signed' : 'Not yet signed',
    },
  ]

  for (const check of checks) {
    const mark = check.met ? '✓' : '✗'
    const markColor = check.met ? GREEN : RED
    txt(page, bold, mark, ML, y, 10, markColor)
    txt(page, reg,  check.label, ML + 16, y, 9, NAVY)
    txt(page, reg,  check.detail, ML + 320, y, 8.5, GRAY)
    y -= 14
  }
  y -= 8

  // Overall eligibility badge
  const badgeText = s.is_eligible ? '✓  ELIGIBLE' : '✗  INELIGIBLE'
  const badgeBg   = s.is_eligible ? rgb(0.9, 1.0, 0.94) : rgb(1.0, 0.93, 0.93)
  const badgeBdr  = s.is_eligible ? rgb(0.6, 0.9, 0.7)  : rgb(0.9, 0.7, 0.7)
  const badgeClr  = s.is_eligible ? GREEN : RED
  page.drawRectangle({ x: ML, y: y - 20, width: W, height: 24, color: badgeBg, borderColor: badgeBdr, borderWidth: 1 })
  txt(page, bold, badgeText, ML + 10, y - 9, 10, badgeClr)
  if (!s.is_eligible && s.ineligibility_reason) {
    txt(page, reg, s.ineligibility_reason, ML + 110, y - 9, 8.5, GRAY)
  }
  y -= 34

  // ── SESSION LOG TABLE ────────────────────────────────────────────────────
  y -= 10
  txt(page, bold, 'SESSION LOG', ML, y, 8, GRAY)
  hRule(page, ML, MR, y - 2, TEAL, 1.5)
  y -= 14

  // Column layout (total W ≈ 524)
  const COL = {
    date:    { x: ML,       w: 52  },
    time:    { x: ML + 52,  w: 72  },
    hrs:     { x: ML + 124, w: 34  },
    act:     { x: ML + 158, w: 52  },
    contact: { x: ML + 210, w: 90  },
    sup:     { x: ML + 300, w: 80  },
    note:    { x: ML + 380, w: MR - (ML + 380) },
  }

  // Table header row
  page.drawRectangle({ x: ML, y: y - 14, width: W, height: 17, color: NAVY })
  const headers: Array<{ label: string; x: number }> = [
    { label: 'Date',        x: COL.date.x + 4    },
    { label: 'Time',        x: COL.time.x + 4    },
    { label: 'Hrs',         x: COL.hrs.x + 2     },
    { label: 'Activity',    x: COL.act.x + 2     },
    { label: 'Contact',     x: COL.contact.x + 2 },
    { label: 'Supervisor',  x: COL.sup.x + 2     },
    { label: 'Description', x: COL.note.x + 2    },
  ]
  for (const h of headers) txt(page, bold, h.label, h.x, y - 10, 7.5, WHITE)
  y -= 17

  // Rows
  let rowIndex = 0
  for (const sess of data.sessions) {
    const ROW_H = 14

    if (y < 60) {
      // Footer before new page
      drawPageFooter(page, reg, ML, MR)
      ;[page, y] = addPage()
      // Re-draw table header on continuation page
      page.drawRectangle({ x: ML, y: y - 14, width: W, height: 17, color: NAVY })
      for (const h of headers) txt(page, bold, h.label, h.x, y - 10, 7.5, WHITE)
      y -= 17
      rowIndex = 0
    }

    // Alternating row background
    if (rowIndex % 2 === 0) {
      page.drawRectangle({ x: ML, y: y - ROW_H + 3, width: W, height: ROW_H, color: MGRAY })
    }

    const dateLabel = new Date(sess.session_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const timeLabel = `${formatTime(sess.start_time)}–${formatTime(sess.end_time)}`
    const actLabel  = sess.activity_type === 'unrestricted' ? 'Unrest.' : 'Restr.'
    const contactLabel = CONTACT_SHORT[sess.contact_type] ?? sess.contact_type
    const noteLabel = truncate(sess.session_note, 55)

    txt(page, reg, dateLabel,                      COL.date.x + 4,    y - 8, 7.5)
    txt(page, reg, timeLabel,                      COL.time.x + 4,    y - 8, 7)
    txt(page, reg, sess.total_hours.toFixed(2),    COL.hrs.x + 2,     y - 8, 7.5)
    txt(page, reg, actLabel,                       COL.act.x + 2,     y - 8, 7.5)
    txt(page, reg, contactLabel,                   COL.contact.x + 2, y - 8, 7.5)
    txt(page, reg, truncate(sess.supervisor_name, 14), COL.sup.x + 2, y - 8, 7.5)
    txt(page, reg, noteLabel,                      COL.note.x + 2,    y - 8, 7)

    y -= ROW_H
    rowIndex++
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  drawPageFooter(page, reg, ML, MR)

  return doc.save()
}

function drawPageFooter(page: PDFPage, font: PDFFont, ML: number, MR: number) {
  const PH   = page.getHeight()
  const PW   = page.getWidth()
  const LGRAY = rgb(0.78, 0.78, 0.78)
  const GRAY  = rgb(0.40, 0.40, 0.40)
  const y = 28
  page.drawLine({ start: { x: ML, y: y + 10 }, end: { x: MR, y: y + 10 }, thickness: 0.5, color: LGRAY })
  const footer = 'Generated by Path4ABA — for reference only. Official M-FVF must be signed by supervisor.'
  const fW = font.widthOfTextAtSize(footer, 7)
  page.drawText(footer, { x: (PW - fW) / 2, y, size: 7, font, color: GRAY })
}
