import { PDFDocument } from 'pdf-lib'

export interface MvfData {
  traineeName: string
  traineeBacbId: string
  monthLabel: string
  fieldworkType: string
  state: string
  country: string
  supervisorName: string
  supervisorBacbId: string
  independentHours: number
  supervisedHours: number
  totalHours: number
  supervisionPct: number
  isEligible: boolean
}

export async function generateMvfPdf(data: MvfData): Promise<Uint8Array> {
  const templateBytes = await fetch('/forms/mfvf-template.pdf').then(r => r.arrayBuffer())
  const pdfDoc = await PDFDocument.load(templateBytes)
  const form = pdfDoc.getForm()

  const setField = (name: string, value: string) => {
    try { form.getTextField(name).setText(value) } catch {}
  }

  setField('TRAINEE_NAME', data.traineeName)
  setField('TRAINEE_BACB_ID', data.traineeBacbId)
  setField('TRAINEE_CERTIFICATE_MONTH/YEAR', data.monthLabel)
  setField('TRAINEE_FIELDWORK_STATE', data.state)
  setField('TRAINEE_FIELDWORK_COUNTRY', data.country)
  setField('RESPONSIBLE_SUPERVISOR_NAME', data.supervisorName)
  setField('RESPONSIBLE_SUPERVISOR_BACB_ID', data.supervisorBacbId)
  setField('INDEPENDENT_HOURS', data.independentHours.toFixed(2))
  setField('SUPERVISED_HOURS', data.supervisedHours.toFixed(2))
  setField('TOTAL_FIELDWORK', data.totalHours.toFixed(2))
  setField('PERCENT_HOURS_SUPERVISED', data.supervisionPct.toFixed(1) + '%')

  try {
    if (data.fieldworkType === 'supervised') {
      form.getCheckBox('CHECK_SUPERVISED_FIELDWORK').check()
    }
  } catch {}

  // Prorated checkbox — supervised fieldwork, month did not meet all requirements
  if (data.fieldworkType === 'supervised' && !data.isEligible) {
    try {
      form.getCheckBox('This fieldwork included prorated hours for a partial month. ').check()
    } catch {}
  }

  return pdfDoc.save()
}
