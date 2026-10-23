import { differenceInCalendarDays, endOfMonth, isAfter, isBefore, parseISO } from 'date-fns'

export type BillStatus = 'draft' | 'finalized'

export type RentalSettings = {
  id: string
  rentalStartDate: string
  baseMonthlyRent: number
  rentAppliesFromDate: string
  annualRentIncreasePercent: number
  waterChargePerPerson: number
  numberOfPeople: number
  electricityRatePerUnit: number
  initialMainMeterReading: number
  initialPumpMeterReading: number
  initialReadingDate: string
  createdAt: string
  updatedAt: string
}

export type MonthlyBill = {
  id: string
  userId: string
  billingMonth: string
  periodStart: string
  periodEnd: string
  previousMainMeterReading: number
  currentMainMeterReading: number
  previousPumpMeterReading: number
  currentPumpMeterReading: number
  mainUnitsConsumed: number
  pumpUnitsConsumed: number
  netElectricityUnits: number
  electricityRatePerUnit: number
  waterChargePerPerson: number
  numberOfPeople: number
  waterCharges: number
  applicableRent: number
  rentDetails: {
    annualIncreasePercent: number
    rentStartDate: string
    rentEndDate: string
    oldRate: number
    newRate: number
    oldDays: number
    newDays: number
    anniversaryDate: string | null
    reason: string
  }
  electricityCharge: number
  totalPayable: number
  status: BillStatus
  createdAt: string
  updatedAt: string
}

export type BillValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export const DEFAULT_SETTINGS: Omit<RentalSettings, 'id' | 'createdAt' | 'updatedAt'> = {
  rentalStartDate: '2023-01-15',
  baseMonthlyRent: 16538,
  rentAppliesFromDate: '2023-01-15',
  annualRentIncreasePercent: 5,
  waterChargePerPerson: 150,
  numberOfPeople: 3,
  electricityRatePerUnit: 10,
  initialMainMeterReading: 12000,
  initialPumpMeterReading: 800,
  initialReadingDate: '2023-01-01',
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function parseDate(dateValue: string): Date {
  return parseISO(dateValue)
}

export function getMonthPeriodFromMonth(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split('-').map(Number)
  const startDate = new Date(year, month - 1, 1)
  const endDate = endOfMonth(startDate)
  return {
    start: toISODate(startDate),
    end: toISODate(endDate),
  }
}

export function toISODate(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getAnniversaryDate(startDate: string, anniversaryNumber: number): Date {
  const start = parseDate(startDate)
  const year = start.getFullYear() + anniversaryNumber
  const month = start.getMonth()
  const day = start.getDate()

  const lastDayOfMonth = new Date(year, month + 1, 0).getDate()
  const safeDay = Math.min(day, lastDayOfMonth)

  return new Date(year, month, safeDay)
}

export function getRentMultiplier(settings: Pick<RentalSettings, 'annualRentIncreasePercent' | 'rentalStartDate'>, targetDate: string): number {
  const start = parseDate(settings.rentalStartDate)
  const target = parseDate(targetDate)
  const yearDifference = target.getFullYear() - start.getFullYear()
  const anniversaryDateThisYear = new Date(target.getFullYear(), start.getMonth(), start.getDate())
  const adjustedYears = isBefore(target, anniversaryDateThisYear) ? yearDifference - 1 : yearDifference
  return Math.pow(1 + settings.annualRentIncreasePercent / 100, Math.max(0, adjustedYears))
}

export function calculateRentForSpecificDate(
  settings: Pick<RentalSettings, 'baseMonthlyRent' | 'annualRentIncreasePercent' | 'rentalStartDate'>,
  targetDate: string,
): number {
  return roundCurrency(settings.baseMonthlyRent * getRentMultiplier(settings, targetDate))
}

export function calculateApplicableRentForPeriod(
  settings: Pick<RentalSettings, 'baseMonthlyRent' | 'annualRentIncreasePercent' | 'rentalStartDate'>,
  periodStart: string,
  periodEnd: string,
): {
  amount: number
  details: {
    annualIncreasePercent: number
    rentStartDate: string
    rentEndDate: string
    oldRate: number
    newRate: number
    oldDays: number
    newDays: number
    anniversaryDate: string | null
    reason: string
  }
} {
  const start = parseDate(periodStart)
  const end = parseDate(periodEnd)
  const startRate = calculateRentForSpecificDate(settings, periodStart)
  const endRate = calculateRentForSpecificDate(settings, periodEnd)
  const periodDays = differenceInCalendarDays(end, start) + 1

  const anniversaryDates: Date[] = []
  let anniversaryCounter = 0
  while (true) {
    const candidate = getAnniversaryDate(settings.rentalStartDate, anniversaryCounter)
    if (isAfter(candidate, end)) break
    if (!isBefore(candidate, start) || candidate.getTime() === start.getTime()) {
      anniversaryDates.push(candidate)
    }
    anniversaryCounter += 1
  }

  const anniversary = anniversaryDates.find((date) => toISODate(date) >= periodStart && toISODate(date) <= periodEnd)

  if (anniversary) {
    const annualDateIso = toISODate(anniversary)
    const oldDays = Math.max(0, differenceInCalendarDays(anniversary, start))
    const newDays = Math.max(0, periodDays - oldDays)
    const blended = (startRate * oldDays + endRate * newDays) / periodDays
    return {
      amount: roundCurrency(blended),
      details: {
        annualIncreasePercent: settings.annualRentIncreasePercent,
        rentStartDate: periodStart,
        rentEndDate: periodEnd,
        oldRate: startRate,
        newRate: endRate,
        oldDays,
        newDays,
        anniversaryDate: annualDateIso,
        reason: `Rent anniversary on ${annualDateIso} was prorated by calendar days.`,
      },
    }
  }

  return {
    amount: roundCurrency(startRate),
    details: {
      annualIncreasePercent: settings.annualRentIncreasePercent,
      rentStartDate: periodStart,
      rentEndDate: periodEnd,
      oldRate: startRate,
      newRate: endRate,
      oldDays: periodDays,
      newDays: 0,
      anniversaryDate: null,
      reason: 'No rent anniversary fell in the selected billing period.',
    },
  }
}

export function calculateMainConsumption(previousReading: number, currentReading: number): number {
  return roundCurrency(currentReading - previousReading)
}

export function calculatePumpConsumption(previousReading: number, currentReading: number): number {
  return roundCurrency(currentReading - previousReading)
}

export function calculateNetElectricityUnits(mainUnits: number, pumpUnits: number): number {
  return roundCurrency(mainUnits - pumpUnits)
}

export function calculateWaterCharge(numberOfPeople: number, waterChargePerPerson: number): number {
  return roundCurrency(numberOfPeople * waterChargePerPerson)
}

export function calculateElectricityCharge(netUnits: number, ratePerUnit: number): number {
  return roundCurrency(netUnits * ratePerUnit)
}

export function validateMeterReadings(input: {
  previousMainMeterReading: number
  currentMainMeterReading: number
  previousPumpMeterReading: number
  currentPumpMeterReading: number
  electricityRatePerUnit: number
  waterChargePerPerson: number
  numberOfPeople: number
}): BillValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const readings = [
    { name: 'Previous main meter reading', value: input.previousMainMeterReading },
    { name: 'Current main meter reading', value: input.currentMainMeterReading },
    { name: 'Previous pump submeter reading', value: input.previousPumpMeterReading },
    { name: 'Current pump submeter reading', value: input.currentPumpMeterReading },
  ]

  readings.forEach(({ name, value }) => {
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`${name} must be a valid number that is not negative.`)
    }
  })

  if (input.currentMainMeterReading < input.previousMainMeterReading) {
    errors.push('Current main meter reading cannot be lower than the previous reading unless a documented reset or replacement workflow is used.')
  }

  if (input.currentPumpMeterReading < input.previousPumpMeterReading) {
    errors.push('Current pump meter reading cannot be lower than the previous reading unless a documented reset or replacement workflow is used.')
  }

  const mainUnits = calculateMainConsumption(input.previousMainMeterReading, input.currentMainMeterReading)
  const pumpUnits = calculatePumpConsumption(input.previousPumpMeterReading, input.currentPumpMeterReading)
  const netUnits = calculateNetElectricityUnits(mainUnits, pumpUnits)

  if (mainUnits < 0) {
    errors.push('Main meter consumption cannot be negative.')
  }

  if (pumpUnits < 0) {
    errors.push('Pump meter consumption cannot be negative.')
  }

  if (netUnits < 0) {
    errors.push('Net electricity consumption cannot be negative.')
  }

  if (pumpUnits > mainUnits) {
    errors.push('Pump consumption exceeds the main meter consumption. Check the readings before finalizing the bill.')
  }

  if (!Number.isFinite(input.electricityRatePerUnit) || input.electricityRatePerUnit <= 0) {
    errors.push('Electricity rate per unit must be a positive number.')
  }

  if (!Number.isFinite(input.waterChargePerPerson) || input.waterChargePerPerson <= 0) {
    errors.push('Water charge per person must be a positive number.')
  }

  if (!Number.isFinite(input.numberOfPeople) || input.numberOfPeople < 0) {
    errors.push('Number of people must be zero or more.')
  }

  return { valid: errors.length === 0, errors, warnings }
}

export function buildMonthlyBillFromReadings(params: {
  userId: string
  settings: Pick<
    RentalSettings,
    'baseMonthlyRent' | 'annualRentIncreasePercent' | 'rentalStartDate' | 'waterChargePerPerson' | 'numberOfPeople' | 'electricityRatePerUnit'
  >
  billingMonth: string
  previousMainMeterReading: number
  currentMainMeterReading: number
  previousPumpMeterReading: number
  currentPumpMeterReading: number
  status?: BillStatus
  createdAt?: string
  updatedAt?: string
  id?: string
  existingBills?: MonthlyBill[]
}): { bill: MonthlyBill; validation: BillValidationResult } {
  const { billingMonth, status = 'draft', existingBills = [] } = params
  const validation = validateMeterReadings({
    previousMainMeterReading: params.previousMainMeterReading,
    currentMainMeterReading: params.currentMainMeterReading,
    previousPumpMeterReading: params.previousPumpMeterReading,
    currentPumpMeterReading: params.currentPumpMeterReading,
    electricityRatePerUnit: params.settings.electricityRatePerUnit,
    waterChargePerPerson: params.settings.waterChargePerPerson,
    numberOfPeople: params.settings.numberOfPeople,
  })

  const period = getMonthPeriodFromMonth(billingMonth)
  const rentCalculation = calculateApplicableRentForPeriod(
    {
      baseMonthlyRent: params.settings.baseMonthlyRent,
      annualRentIncreasePercent: params.settings.annualRentIncreasePercent,
      rentalStartDate: params.settings.rentalStartDate,
    },
    period.start,
    period.end,
  )

  const mainUnits = calculateMainConsumption(params.previousMainMeterReading, params.currentMainMeterReading)
  const pumpUnits = calculatePumpConsumption(params.previousPumpMeterReading, params.currentPumpMeterReading)
  const netUnits = calculateNetElectricityUnits(mainUnits, pumpUnits)
  const waterCharge = calculateWaterCharge(params.settings.numberOfPeople, params.settings.waterChargePerPerson)
  const electricityCharge = calculateElectricityCharge(netUnits, params.settings.electricityRatePerUnit)
  const totalPayable = roundCurrency(rentCalculation.amount + waterCharge + electricityCharge)

  const duplicateBill = existingBills.find((bill) => bill.billingMonth === billingMonth && bill.status === 'finalized')
  if (duplicateBill) {
    validation.errors.push('A finalized bill already exists for this billing month.')
    validation.valid = false
  }

  const bill: MonthlyBill = {
    id: params.id ?? crypto.randomUUID(),
    userId: params.userId,
    billingMonth,
    periodStart: period.start,
    periodEnd: period.end,
    previousMainMeterReading: params.previousMainMeterReading,
    currentMainMeterReading: params.currentMainMeterReading,
    previousPumpMeterReading: params.previousPumpMeterReading,
    currentPumpMeterReading: params.currentPumpMeterReading,
    mainUnitsConsumed: mainUnits,
    pumpUnitsConsumed: pumpUnits,
    netElectricityUnits: netUnits,
    electricityRatePerUnit: params.settings.electricityRatePerUnit,
    waterChargePerPerson: params.settings.waterChargePerPerson,
    numberOfPeople: params.settings.numberOfPeople,
    waterCharges: waterCharge,
    applicableRent: rentCalculation.amount,
    rentDetails: rentCalculation.details,
    electricityCharge,
    totalPayable,
    status,
    createdAt: params.createdAt ?? new Date().toISOString(),
    updatedAt: params.updatedAt ?? new Date().toISOString(),
  }

  return { bill, validation }
}

export function findPreviousBillForMonth(existingBills: MonthlyBill[], billingMonth: string): MonthlyBill | undefined {
  const targetMonth = new Date(`${billingMonth}-01T00:00:00`)
  return [...existingBills]
    .filter((bill) => bill.status === 'finalized')
    .sort((a, b) => new Date(`${b.billingMonth}-01T00:00:00`).getTime() - new Date(`${a.billingMonth}-01T00:00:00`).getTime())
    .find((bill) => new Date(`${bill.billingMonth}-01T00:00:00`).getTime() < targetMonth.getTime())
}

export function getNextSuggestedMeterReadings(
  existingBills: MonthlyBill[],
  meterType: 'main' | 'pump',
): number | undefined {
  const finalizedBills = [...existingBills].filter((bill) => bill.status === 'finalized')
  if (finalizedBills.length === 0) return undefined

  const latest = finalizedBills.sort((a, b) => new Date(`${b.billingMonth}-01T00:00:00`).getTime() - new Date(`${a.billingMonth}-01T00:00:00`).getTime())[0]
  if (meterType === 'main') {
    return latest.currentMainMeterReading
  }

  return latest.currentPumpMeterReading
}

export function getPreviousMonthReference(existingBills: MonthlyBill[], currentBillingMonth: string): MonthlyBill | undefined {
  const target = new Date(`${currentBillingMonth}-01T00:00:00`)
  const previous = [...existingBills]
    .filter((bill) => bill.status === 'finalized')
    .filter((bill) => new Date(`${bill.billingMonth}-01T00:00:00`).getTime() < target.getTime())
    .sort((a, b) => new Date(`${b.billingMonth}-01T00:00:00`).getTime() - new Date(`${a.billingMonth}-01T00:00:00`).getTime())[0]

  return previous
}

export function buildSettingsSnapshot(settings: Omit<RentalSettings, 'id' | 'createdAt' | 'updatedAt'>): RentalSettings {
  const timestamp = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    ...settings,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
