import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib'

export interface SupervisionPdfData {
  traineeName: string
  certificationTrack: string
  sessionDate: string       // YYYY-MM-DD
  startTime: string         // HH:MM
  endTime: string           // HH:MM
  contactType: 'individual_supervision' | 'group_supervision' | 'client_observation'
  sessionNote: string | null
  supervisorName: string
  independentHoursOnDate: number
  totalMonthHours: number
}

// ── Colors ──────────────────────────────────────────────────────────────────
const TEAL   = rgb(0.106, 0.659, 0.627)
const NAVY   = rgb(0.051, 0.169, 0.306)
const GRAY   = rgb(0.40, 0.40, 0.40)
const LGRAY  = rgb(0.78, 0.78, 0.78)
const WHITE  = rgb(1, 1, 1)
const AMBER  = rgb(0.60, 0.35, 0.00)
const AMB_BG = rgb(1.00, 0.97, 0.85)
const AMB_BR = rgb(0.95, 0.80, 0.40)

// ── Helpers ──────────────────────────────────────────────────────────────────

function hRule(page: PDFPage, x1: number, x2: number, y: number, color = LGRAY, thickness = 0.75) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color })
}

function label(page: PDFPage, font: PDFFont, text: string, x: number, y: number) {
  page.drawText(text, { x, y, size: 7.5, font, color: GRAY })
}

function value(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size = 10) {
  page.drawText(text, { x, y, size, font, color: NAVY })
}

function blankLine(page: PDFPage, x: number, y: number, width: number) {
  hRule(page, x, x + width, y, LGRAY, 0.75)
}

function checkbox(page: PDFPage, font: PDFFont, x: number, y: number, checked: boolean, lbl: string) {
  page.drawRectangle({ x, y, width: 9, height: 9, borderColor: NAVY, borderWidth: 1, color: checked ? NAVY : WHITE })
  if (checked) page.drawText('✓', { x: x + 1.5, y: y + 1.5, size: 7, font, color: WHITE })
  page.drawText(lbl, { x: x + 13, y: y + 1, size: 9.5, font, color: NAVY })
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ')
    let current = ''
    for (const word of words) {
      const test = current ? current + ' ' + word : word
      if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = test
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function formatDuration(start: string, end: string): string {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (m === 0) return `${h} hour${h !== 1 ? 's' : ''}`
  if (h === 0) return `${m} minute${m !== 1 ? 's' : ''}`
  return `${h} hour${h !== 1 ? 's' : ''} ${m} min`
}

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateSupervisionPdf(data: SupervisionPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const { width, height } = page.getSize()

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const font     = await doc.embedFont(StandardFonts.Helvetica)
  const fontObl  = await doc.embedFont(StandardFonts.HelveticaOblique)

  const ML = 50            // left margin
  const MR = width - 50   // right margin
  const W  = MR - ML      // total usable width
  const CW = (W - 22) / 2 // column width
  const RX = ML + CW + 22 // right column x

  // ── HEADER ────────────────────────────────────────────────────────────────
  let y = height - 48

  // Teal top accent bar
  page.drawRectangle({ x: ML, y: y + 6, width: W, height: 4, color: TEAL })
  y -= 14

  // Title
  const titleText = 'SUPERVISION MEETING FORM'
  const titleW = fontBold.widthOfTextAtSize(titleText, 17)
  page.drawText(titleText, { x: (width - titleW) / 2, y, size: 17, font: fontBold, color: NAVY })
  y -= 16

  // Subtitle based on contact type
  const SUBTITLES: Record<string, string> = {
    individual_supervision: 'Individual Supervision Session',
    group_supervision:      'Group Supervision Session',
    client_observation:     'Client Observation + Supervision Session',
  }
  const sub = SUBTITLES[data.contactType]
  const subW = font.widthOfTextAtSize(sub, 10.5)
  page.drawText(sub, { x: (width - subW) / 2, y, size: 10.5, font, color: TEAL })
  y -= 10

  hRule(page, ML, MR, y, LGRAY, 1)
  y -= 20

  // ── INFO GRID (2 columns × 4 rows) ────────────────────────────────────────
  const rowH = 34

  // Row 1
  label(page, font, 'NAME OF SUPERVISEE', ML, y)
  label(page, font, 'MEETING FORMAT', RX, y)
  y -= 14
  value(page, fontBold, data.traineeName || '—', ML, y)
  checkbox(page, font, RX,      y, data.contactType !== 'group_supervision', 'Individual')
  checkbox(page, font, RX + 80, y, data.contactType === 'group_supervision', 'Group')
  blankLine(page, ML, y - 3, CW)
  y -= rowH

  // Row 2
  label(page, font, 'CERTIFICATION SEEKING', ML, y)
  label(page, font, 'INDEPENDENT HOURS ACCUMULATED (THIS DATE)', RX, y)
  y -= 14
  value(page, fontBold, data.certificationTrack || 'BCBA', ML, y)
  value(page, fontBold, data.independentHoursOnDate.toFixed(2) + ' hrs', RX, y)
  blankLine(page, ML, y - 3, CW)
  blankLine(page, RX, y - 3, CW)
  y -= rowH

  // Row 3
  label(page, font, 'DATE OF SUPERVISION', ML, y)
  label(page, font, 'TOTAL HOURS ACCUMULATED (THIS MONTH)', RX, y)
  y -= 14
  value(page, fontBold, formatDate(data.sessionDate), ML, y)
  value(page, fontBold, data.totalMonthHours.toFixed(2) + ' hrs', RX, y)
  blankLine(page, ML, y - 3, CW)
  blankLine(page, RX, y - 3, CW)
  y -= rowH

  // Row 4
  label(page, font, 'DURATION OF SUPERVISION', ML, y)
  label(page, font, 'SUPERVISOR NAME', RX, y)
  y -= 14
  value(page, fontBold, `${formatDuration(data.startTime, data.endTime)}  (${formatTime(data.startTime)} – ${formatTime(data.endTime)})`, ML, y)
  value(page, fontBold, data.supervisorName || '—', RX, y)
  blankLine(page, ML, y - 3, CW)
  blankLine(page, RX, y - 3, CW)
  y -= 20

  hRule(page, ML, MR, y, LGRAY, 0.75)
  y -= 16

  // ── CONDITIONAL SECTION ───────────────────────────────────────────────────

  if (data.contactType === 'client_observation') {
    // Amber bordered box
    const boxH = 52
    page.drawRectangle({ x: ML, y: y - boxH, width: W, height: boxH, color: AMB_BG, borderColor: AMB_BR, borderWidth: 1.5 })
    page.drawText('DIRECT CLIENT OBSERVATION', { x: ML + 10, y: y - 14, size: 9, font: fontBold, color: AMBER })
    page.drawText('Supervisor directly observed trainee working with a real client in the natural environment,', { x: ML + 10, y: y - 27, size: 8.5, font, color: AMBER })
    page.drawText('consistent with BACB requirements for client observation contacts.', { x: ML + 10, y: y - 39, size: 8.5, font, color: AMBER })
    y -= boxH + 12
  }

  if (data.contactType === 'group_supervision') {
    page.drawRectangle({ x: ML, y: y - 24, width: W, height: 24, color: rgb(0.95, 0.97, 1.0), borderColor: LGRAY, borderWidth: 1 })
    page.drawText('Group Supervision Session — maximum 10 trainees per BACB supervision requirements.', {
      x: ML + 10, y: y - 15, size: 8.5, font: fontObl, color: NAVY
    })
    y -= 36
  }

  // ── ACTIVITIES CONDUCTED ─────────────────────────────────────────────────
  page.drawText('ACTIVITIES CONDUCTED', { x: ML, y, size: 8, font: fontBold, color: GRAY })
  hRule(page, ML, MR, y - 2, TEAL, 1.5)
  y -= 16

  if (data.sessionNote) {
    const wrapped = wrapText(data.sessionNote, font, 10, W)
    const maxLines = 4
    const shown = wrapped.slice(0, maxLines)
    for (const ln of shown) {
      page.drawText(ln, { x: ML, y, size: 10, font, color: NAVY })
      y -= 14
    }
    if (wrapped.length > maxLines) y -= 2
  }
  // Always draw at least 2 blank lines
  const linesUsed = data.sessionNote ? Math.min(wrapText(data.sessionNote, font, 10, W).length, 4) : 0
  for (let i = linesUsed; i < 2; i++) {
    blankLine(page, ML, y, W); y -= 16
  }
  y -= 12

  // ── PERFORMANCE FEEDBACK ─────────────────────────────────────────────────
  page.drawText('SUPERVISEE PERFORMANCE FEEDBACK', { x: ML, y, size: 8, font: fontBold, color: GRAY })
  hRule(page, ML, MR, y - 2, TEAL, 1.5)
  y -= 16
  for (let i = 0; i < 3; i++) { blankLine(page, ML, y, W); y -= 16 }
  y -= 12

  // ── FOLLOW-UP INFORMATION ────────────────────────────────────────────────
  page.drawText('FOLLOW-UP INFORMATION', { x: ML, y, size: 8, font: fontBold, color: GRAY })
  hRule(page, ML, MR, y - 2, TEAL, 1.5)
  y -= 16
  for (let i = 0; i < 3; i++) { blankLine(page, ML, y, W); y -= 16 }
  y -= 18

  // ── SIGNATURES ────────────────────────────────────────────────────────────
  hRule(page, ML, MR, y, LGRAY, 1)
  y -= 20

  const sigW = CW * 0.72
  const dateW = CW * 0.24

  // Supervisor
  page.drawText('SUPERVISOR', { x: ML, y, size: 7.5, font: fontBold, color: GRAY })
  page.drawText('SUPERVISEE / TRAINEE', { x: RX, y, size: 7.5, font: fontBold, color: GRAY })
  y -= 20
  blankLine(page, ML, y, sigW)
  blankLine(page, ML + sigW + 10, y, dateW)
  blankLine(page, RX, y, sigW)
  blankLine(page, RX + sigW + 10, y, dateW)
  y -= 14
  page.drawText('Signature', { x: ML, y, size: 7.5, font, color: GRAY })
  page.drawText('Date', { x: ML + sigW + 10, y, size: 7.5, font, color: GRAY })
  page.drawText('Signature', { x: RX, y, size: 7.5, font, color: GRAY })
  page.drawText('Date', { x: RX + sigW + 10, y, size: 7.5, font, color: GRAY })
  y -= 22
  blankLine(page, ML, y, CW)
  blankLine(page, RX, y, CW)
  y -= 14
  page.drawText('Printed Name', { x: ML, y, size: 7.5, font, color: GRAY })
  page.drawText('Printed Name', { x: RX, y, size: 7.5, font, color: GRAY })
  y -= 20

  // ── FOOTER ────────────────────────────────────────────────────────────────
  hRule(page, ML, MR, y, LGRAY, 0.75)
  y -= 12
  const footerText = `Generated by Path4ABA · path4aba.app · Session: ${data.sessionDate}`
  const footerW = font.widthOfTextAtSize(footerText, 7)
  page.drawText(footerText, { x: (width - footerW) / 2, y, size: 7, font, color: LGRAY })

  return doc.save()
}
