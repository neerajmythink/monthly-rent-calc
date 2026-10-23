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
      const left = 15
      let y = 20
      const money = (amount: number) => `INR ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(17)
      pdf.text('Rental Bill', left, y)
      y += 8
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.text(format(parseISO(`${formState.billingMonth}-01`), 'MMM yyyy'), left, y)
      y += 4

      const table = (title: string, rows: string[][]) => {
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(10)
        pdf.text(title, left, y)
        y += 1
        autoTable(pdf, {
          startY: y,
          head: [['Item', 'Details']],
          body: rows,
          theme: 'grid',
          margin: { left, right: left },
          styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, textColor: [30, 41, 59], minCellHeight: 6 },
          headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: 'bold', cellPadding: 2 },
          columnStyles: {
            0: { cellWidth: 78 },
            1: { halign: 'right' },
          },
        })
        y = (pdf as JsPDFDocument & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4
      }

      table('Rent', [
        ['Monthly rent', money(built.bill.applicableRent)],
      ])
      table('Electricity', [
        ['Main meter', `${built.bill.previousMainMeterReading} → ${built.bill.currentMainMeterReading} (${built.bill.mainUnitsConsumed} used)`],
        ['Pump meter', `${built.bill.previousPumpMeterReading} → ${built.bill.currentPumpMeterReading} (${built.bill.pumpUnitsConsumed} used)`],
        ['Tenant usage', `${built.bill.netElectricityUnits} units × ${money(built.bill.electricityRatePerUnit)}`],
        ['Electricity charge', money(built.bill.electricityCharge)],
      ])
      table('Water', [
        ['People', `${built.bill.numberOfPeople}`],
        ['Rate per person', money(built.bill.waterChargePerPerson)],
        ['Water charge', money(built.bill.waterCharges)],
      ])

      if (y > 265) {
        pdf.addPage()
        y = 22
      }
      autoTable(pdf, {
        startY: y,
        head: [['TOTAL PAYABLE', money(built.bill.totalPayable)]],
        body: [],
        theme: 'grid',
        margin: { left, right: left },
        styles: { font: 'helvetica', fontSize: 11, cellPadding: 3, fontStyle: 'bold' },
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
        columnStyles: { 1: { halign: 'right' } },
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
