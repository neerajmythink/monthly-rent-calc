import { useMemo, useState } from 'react'
import { AlertCircle, Calculator, CheckCircle2, FileDown } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import type { jsPDF as JsPDFDocument } from 'jspdf'
import {
  buildMonthlyBillFromReadings,
  calculateElectricityCharge,
  calculateMainConsumption,
  calculatePumpConsumption,
  calculateWaterCharge,
  DEFAULT_SETTINGS,
  formatCurrency,
  roundCurrency,
  validateMeterReadings,
  type RentalSettings,
} from './lib/calculations'
import './App.css'

const INITIAL_MONTH = format(new Date(), 'yyyy-MM')
const INITIAL_TIMESTAMP = new Date().toISOString()
const INITIAL_SETTINGS: RentalSettings = {
  id: 'settings-local',
  ...DEFAULT_SETTINGS,
  createdAt: INITIAL_TIMESTAMP,
  updatedAt: INITIAL_TIMESTAMP,
}

function App() {
  const [settings, setSettings] = useState<RentalSettings>(INITIAL_SETTINGS)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formState, setFormState] = useState({
    billingMonth: INITIAL_MONTH,
    previousMainMeterReading: DEFAULT_SETTINGS.initialMainMeterReading,
    currentMainMeterReading: DEFAULT_SETTINGS.initialMainMeterReading,
    previousPumpMeterReading: DEFAULT_SETTINGS.initialPumpMeterReading,
    currentPumpMeterReading: DEFAULT_SETTINGS.initialPumpMeterReading,
  })

  const preview = useMemo(() => {
    const validation = validateMeterReadings({
      previousMainMeterReading: formState.previousMainMeterReading,
      currentMainMeterReading: formState.currentMainMeterReading,
      previousPumpMeterReading: formState.previousPumpMeterReading,
      currentPumpMeterReading: formState.currentPumpMeterReading,
      electricityRatePerUnit: settings.electricityRatePerUnit,
      waterChargePerPerson: settings.waterChargePerPerson,
      numberOfPeople: settings.numberOfPeople,
    })

    const mainUnits = calculateMainConsumption(
      formState.previousMainMeterReading,
      formState.currentMainMeterReading,
    )
    const pumpUnits = calculatePumpConsumption(
      formState.previousPumpMeterReading,
      formState.currentPumpMeterReading,
    )
    const netUnits = mainUnits - pumpUnits
    const waterCharges = calculateWaterCharge(settings.numberOfPeople, settings.waterChargePerPerson)
    const applicableRent = roundCurrency(settings.baseMonthlyRent)
    const electricityCharge = calculateElectricityCharge(netUnits, settings.electricityRatePerUnit)

    return {
      validation,
      mainUnits,
      pumpUnits,
      netUnits,
      waterCharges,
      applicableRent,
      electricityCharge,
      totalPayable: roundCurrency(applicableRent + waterCharges + electricityCharge),
    }
  }, [formState, settings])

  const handleCreatePdfBill = async () => {
    if (!preview.validation.valid) {
      setError(preview.validation.errors[0] ?? 'Please fix the bill before saving.')
      setSuccess('')
      return
    }

    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ])
      const built = buildMonthlyBillFromReadings({
        userId: 'local-only',
        settings: {
          baseMonthlyRent: settings.baseMonthlyRent,
          annualRentIncreasePercent: 0,
          rentalStartDate: settings.rentalStartDate,
          waterChargePerPerson: settings.waterChargePerPerson,
          numberOfPeople: settings.numberOfPeople,
          electricityRatePerUnit: settings.electricityRatePerUnit,
        },
        billingMonth: formState.billingMonth,
        previousMainMeterReading: formState.previousMainMeterReading,
        currentMainMeterReading: formState.currentMainMeterReading,
        previousPumpMeterReading: formState.previousPumpMeterReading,
        currentPumpMeterReading: formState.currentPumpMeterReading,
        status: 'finalized',
        existingBills: [],
      })

      if (!built.validation.valid) {
        setError(built.validation.errors[0])
        setSuccess('')
        return
      }

      const pdf = new jsPDF()
      const doc = pdf as JsPDFDocument & { lastAutoTable: { finalY: number } }
      const PW = pdf.internal.pageSize.getWidth()   // 210 mm
      const ML = 14                                  // left / right margin
      const CW = (PW - ML * 2 - 4) / 2             // half-column width (~89 mm)
      const FW = PW - ML * 2                        // full-width content (~182 mm)
      let y = 14

      const money = (n: number) =>
        'INR ' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

      // Shared compact row style
      const rowStyle = {
        font: 'helvetica' as const,
        fontSize: 8,
        cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
        textColor: [71, 85, 105] as [number, number, number],
        lineColor: [226, 232, 240] as [number, number, number],
        lineWidth: 0.2,
      }

      // Highlight the section-total (last) row
      const highlightLast = (lastIdx: number) => (data: Parameters<NonNullable<Parameters<typeof autoTable>[1]['didParseCell']>>[0]) => {
        if (data.row.index === lastIdx) {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.textColor = [15, 23, 42]
          data.cell.styles.fillColor = [241, 245, 249]
          data.cell.styles.fontSize = 8.5
          data.cell.styles.cellPadding = { top: 3, bottom: 3, left: 4, right: 4 }
        }
      }

      // Draw a section card header at (x, y) with given width
      const cardHeader = (x: number, w: number, num: string, title: string, sub: string) => {
        pdf.setFillColor(239, 246, 255)
        pdf.roundedRect(x, y, w, 10, 2, 2, 'F')
        pdf.setFillColor(30, 64, 175)
        pdf.roundedRect(x + 2.5, y + 1.5, 8, 7, 1.5, 1.5, 'F')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(5.5)
        pdf.setTextColor(255, 255, 255)
        pdf.text(num, x + 6.5, y + 6.2, { align: 'center' })
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8)
        pdf.setTextColor(15, 23, 42)
        pdf.text(title, x + 13, y + 5.2)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(6.5)
        pdf.setTextColor(100, 116, 139)
        pdf.text(sub, x + 13, y + 9)
      }

      // ── Page header ───────────────────────────────────────────────
      pdf.setFillColor(15, 23, 42)
      pdf.roundedRect(ML, y, FW, 17, 3, 3, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(13)
      pdf.setTextColor(255, 255, 255)
      pdf.text('Rental Bill', ML + 5, y + 8)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8.5)
      pdf.setTextColor(148, 163, 184)
      pdf.text(format(parseISO(`${formState.billingMonth}-01`), 'MMMM yyyy'), ML + 5, y + 14)
      y += 21

      // ── 01 Main Rent  +  02 Water Bill  (side by side) ───────────
      cardHeader(ML, CW, '01', 'Main Rent', 'Billing month and base rent.')
      cardHeader(ML + CW + 4, CW, '02', 'Water Bill', 'Charge by household size.')
      y += 11

      const rowStart = y

      autoTable(pdf, {
        startY: rowStart,
        body: [
          ['Billing month', format(parseISO(`${formState.billingMonth}-01`), 'MMM yyyy')],
          ['Base monthly rent', money(settings.baseMonthlyRent)],
          ['Applicable rent', money(built.bill.applicableRent)],
        ],
        theme: 'plain',
        margin: { left: ML, right: PW - (ML + CW) },
        styles: rowStyle,
        columnStyles: { 0: { cellWidth: CW * 0.58 }, 1: { halign: 'right' } },
        didParseCell: highlightLast(2),
      })
      const endY01 = doc.lastAutoTable.finalY

      autoTable(pdf, {
        startY: rowStart,
        body: [
          ['Number of people', String(built.bill.numberOfPeople)],
          ['Rate per person / month', money(built.bill.waterChargePerPerson)],
          ['Water charge', money(built.bill.waterCharges)],
        ],
        theme: 'plain',
        margin: { left: ML + CW + 4, right: ML },
        styles: rowStyle,
        columnStyles: { 0: { cellWidth: CW * 0.58 }, 1: { halign: 'right' } },
        didParseCell: highlightLast(2),
      })
      const endY02 = doc.lastAutoTable.finalY

      y = Math.max(endY01, endY02) + 5

      // ── 03 Electricity Bill  (full width, 4-column grid) ─────────
      cardHeader(ML, FW, '03', 'Electricity Bill', 'Main meter less common pump usage.')
      y += 11

      // Columns: [main-label | main-value | pump-label | pump-value]
      const c0 = FW * 0.28
      const c1 = FW * 0.22
      const c2 = FW * 0.28
      // c3 takes remaining width

      autoTable(pdf, {
        startY: y,
        body: [
          ['Main meter – previous', `${built.bill.previousMainMeterReading} units`, 'Pump meter – previous', `${built.bill.previousPumpMeterReading} units`],
          ['Main meter – current',  `${built.bill.currentMainMeterReading} units`,  'Pump meter – current',  `${built.bill.currentPumpMeterReading} units`],
          ['Main units consumed',   `${built.bill.mainUnitsConsumed} units`,         'Pump units consumed',   `${built.bill.pumpUnitsConsumed} units`],
          ['Net units (tenant)',     `${built.bill.netElectricityUnits} units`,       'Rate per unit',         money(built.bill.electricityRatePerUnit)],
          ['Electricity charge',     money(built.bill.electricityCharge),             '',                      ''],
        ],
        theme: 'plain',
        margin: { left: ML, right: ML },
        styles: rowStyle,
        columnStyles: {
          0: { cellWidth: c0 },
          1: { cellWidth: c1, halign: 'right' },
          2: { cellWidth: c2 },
          3: { halign: 'right' },
        },
        didParseCell: (data) => {
          if (data.row.index === 4) {
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.textColor = [15, 23, 42]
            data.cell.styles.fillColor = [241, 245, 249]
            data.cell.styles.fontSize = 8.5
            data.cell.styles.cellPadding = { top: 3, bottom: 3, left: 4, right: 4 }
          }
        },
      })
      y = doc.lastAutoTable.finalY + 5

      // ── Total Payable ─────────────────────────────────────────────
      pdf.setFillColor(15, 23, 42)
      pdf.roundedRect(ML, y, FW, 10, 2, 2, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(8.5)
      pdf.setTextColor(255, 255, 255)
      pdf.text('Total Payable', ML + 5, y + 6.8)
      y += 11

      autoTable(pdf, {
        startY: y,
        body: [
          ['Main rent',        money(built.bill.applicableRent)],
          ['Water bill',       money(built.bill.waterCharges)],
          ['Electricity bill', money(built.bill.electricityCharge)],
          ['Total payable',    money(built.bill.totalPayable)],
        ],
        theme: 'plain',
        margin: { left: ML, right: ML },
        styles: rowStyle,
        columnStyles: {
          0: { cellWidth: FW * 0.55 },
          1: { cellWidth: FW * 0.45, halign: 'right' },
        },
        didParseCell: (data) => {
          if (data.row.index === 3) {
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.textColor = [255, 255, 255]
            data.cell.styles.fillColor = [15, 23, 42]
            data.cell.styles.fontSize = 9.5
            data.cell.styles.cellPadding = { top: 4, bottom: 4, left: 4, right: 4 }
          }
        },
      })

      pdf.save(`rental-bill-${formState.billingMonth}.pdf`)
      setError('')
      setSuccess('PDF bill downloaded successfully.')
    } catch {
      setError('Could not create the PDF bill. Please try again.')
      setSuccess('')
    }
  }

  return (
    <div className="app-shell">
      <main className="main-content">
        <header className="page-header">
          <div className="page-mark"><Calculator size={20} /></div>
          <div>
            <p className="eyebrow">Monthly household expenses</p>
            <h1>Rental expense calculator</h1>
          </div>
        </header>

        <section className="billing-sections" aria-label="Monthly bill calculator">
          <div className="rent-water-row">
            <div className="card form-panel bill-section">
              <div className="bill-section-heading">
                <span className="section-number">01</span>
                <div>
                  <h3>Main rent</h3>
                  <p>Billing month and base rent.</p>
                </div>
              </div>
              <div className="compact-fields">
                <label>
                  <span>Billing month</span>
                  <input
                    type="month"
                    value={formState.billingMonth}
                    onChange={(event) => setFormState((current) => ({ ...current, billingMonth: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Base monthly rent (₹)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={settings.baseMonthlyRent}
                    onChange={(event) => setSettings((current) => ({ ...current, baseMonthlyRent: Number(event.target.value) }))}
                  />
                </label>
              </div>
              <div className="section-amount">
                <span>Applicable rent</span>
                <strong>{formatCurrency(preview.applicableRent)}</strong>
              </div>
            </div>

            <div className="card form-panel bill-section">
              <div className="bill-section-heading">
                <span className="section-number">02</span>
                <div>
                  <h3>Water bill</h3>
                  <p>Charge by household size.</p>
                </div>
              </div>
              <div className="compact-fields">
                <label>
                  <span>Number of people</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={settings.numberOfPeople}
                    onChange={(event) => setSettings((current) => ({ ...current, numberOfPeople: Number(event.target.value) }))}
                  />
                </label>
                <label>
                  <span>Water per person (₹/month)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={settings.waterChargePerPerson}
                    onChange={(event) => setSettings((current) => ({ ...current, waterChargePerPerson: Number(event.target.value) }))}
                  />
                </label>
              </div>
              <div className="section-amount">
                <span>Water charge</span>
                <strong>{formatCurrency(preview.waterCharges)}</strong>
              </div>
            </div>
          </div>

          <div className="card form-panel bill-section">
            <div className="bill-section-heading">
              <span className="section-number">03</span>
              <div>
                <h3>Electricity bill</h3>
                <p>Main meter less common pump usage.</p>
              </div>
            </div>
            <div className="electricity-input-layout">
              <div className="meter-pair">
                <fieldset className="meter-group">
                <legend>Main meter (units)</legend>
                <label>
                  <span>Previous</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formState.previousMainMeterReading}
                    onChange={(event) => setFormState((current) => ({ ...current, previousMainMeterReading: Number(event.target.value) }))}
                  />
                </label>
                <label>
                  <span>Current</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formState.currentMainMeterReading}
                    onChange={(event) => setFormState((current) => ({ ...current, currentMainMeterReading: Number(event.target.value) }))}
                  />
                </label>
                <small>Consumed: <strong>{preview.mainUnits} units</strong></small>
                </fieldset>
                <fieldset className="meter-group">
                <legend>Pump meter (units)</legend>
                <label>
                  <span>Previous</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formState.previousPumpMeterReading}
                    onChange={(event) => setFormState((current) => ({ ...current, previousPumpMeterReading: Number(event.target.value) }))}
                  />
                </label>
                <label>
                  <span>Current</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formState.currentPumpMeterReading}
                    onChange={(event) => setFormState((current) => ({ ...current, currentPumpMeterReading: Number(event.target.value) }))}
                  />
                </label>
                <small>Consumed: <strong>{preview.pumpUnits} units</strong></small>
                </fieldset>
              </div>
              <div className="rate-group">
                <label>
                  <span>Rate per unit (₹)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={settings.electricityRatePerUnit}
                    onChange={(event) => setSettings((current) => ({ ...current, electricityRatePerUnit: Number(event.target.value) }))}
                  />
                </label>
                <div className="rate-result">
                  <span>Net units</span>
                  <strong>{preview.netUnits}</strong>
                </div>
                <div className="rate-result">
                  <span>Electricity charge</span>
                  <strong>{formatCurrency(preview.electricityCharge)}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="card bill-total-section">
            <div>
              <p className="eyebrow">Final monthly amount</p>
              <h3>Total payable</h3>
            </div>
            <div className="total-breakdown">
              <div><span>Main rent</span><strong>{formatCurrency(preview.applicableRent)}</strong></div>
              <div><span>Electricity bill</span><strong>{formatCurrency(preview.electricityCharge)}</strong></div>
              <div><span>Water bill</span><strong>{formatCurrency(preview.waterCharges)}</strong></div>
            </div>
            <div className="grand-total">
              <span>Total</span>
              <strong>{formatCurrency(preview.totalPayable)}</strong>
            </div>

            {preview.validation.errors.length > 0 && (
              <div className="error-list">
                {preview.validation.errors.map((issue) => (
                  <div key={issue} className="error-box"><AlertCircle size={16} /> {issue}</div>
                ))}
              </div>
            )}
            {error && <div className="error-box"><AlertCircle size={16} /> {error}</div>}
            {success && <div className="success-box"><CheckCircle2 size={16} /> {success}</div>}
            <div className="button-row">
              <button type="button" className="primary-button" onClick={handleCreatePdfBill}>
                <FileDown size={16} /> Make PDF bill
              </button>
            </div>
          </div>
        </section>

      </main>
    </div>
  )
}

export default App
