/**
 * Debt shaping for the read-only feed.
 *
 * A repayment can be logged on the loan itself or as a 出金 in the ledger
 * tagged with the loan. A desk wants one list per loan, so both are merged
 * here. The ledger side goes through toCashflow, which keeps the amountCNY
 * rule and the field whitelists in one place.
 *
 * Payloads are whatever the client last synced. Anything that is not a loan
 * or the plan is skipped, and every field is coerced, so one bad row cannot
 * take the endpoint down.
 */
import { round2, toCashflow } from './cashflow.js'

const PLAN_ID = 'debt-plan'
const REPAY_TYPES = new Set(['interest_monthly', 'bullet', 'other'])
const REPAY_SOURCES = new Set(['salary', 'savings', 'other'])
const LEDGER_DESTINATIONS = new Set(['repay', 'interest'])
const DATE = /^\d{4}-\d{2}-\d{2}$/

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Numbers and numeric strings only — Number(null) or Number([]) is not 0 owed. */
function finite(value) {
  const parsed = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() ? Number(value) : NaN)
  return Number.isFinite(parsed) ? parsed : null
}

function money(value) {
  return round2(finite(value) ?? 0)
}

function dayOfMonth(value) {
  const parsed = finite(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : null
}

function date(value) {
  const day = typeof value === 'string' ? value.slice(0, 10) : ''
  return DATE.test(day) ? day : null
}

function text(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function compareDates(a, b) {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b)
}

function ownRepayment(item) {
  return {
    id: text(item.id),
    date: date(item.date),
    principal: money(item.principal),
    interest: money(item.interest),
    dueDate: date(item.dueDate),
    source: REPAY_SOURCES.has(item.source) ? item.source : null,
    note: text(item.note),
    entryId: null
  }
}

/**
 * Ledger 出金 marked as repaying principal or paying interest on a loan.
 * Dateless rows are dropped, as the cash-flow feed drops them, so the two
 * endpoints never disagree about which entries exist.
 */
function ledgerRepaymentsByLoan(entries) {
  const byLoan = new Map()
  for (const entry of entries) {
    if (!isObject(entry) || entry.type !== '出金') continue
    const row = toCashflow(entry)
    if (!row.loanId || !row.date || !LEDGER_DESTINATIONS.has(row.destination)) continue
    const list = byLoan.get(row.loanId) || []
    list.push({
      id: `entry:${row.id}`,
      date: row.date,
      principal: row.destination === 'repay' ? row.amountCNY : 0,
      interest: row.destination === 'interest' ? row.amountCNY : 0,
      dueDate: null,
      source: 'ledger',
      note: row.note,
      entryId: row.id
    })
    byLoan.set(row.loanId, list)
  }
  return byLoan
}

function toLoan(payload, fromLedger) {
  const id = text(payload.id)
  const own = Array.isArray(payload.repayments)
    ? payload.repayments.filter(isObject).map(ownRepayment)
    : []
  // Stable sort: on the same day the loan's own rows stay ahead of the ledger's.
  const repayments = [...own, ...(fromLedger.get(id) || [])]
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))

  let repaid = 0
  let interest = 0
  for (const repayment of repayments) {
    repaid += repayment.principal
    interest += repayment.interest
  }
  const principal = money(payload.principal)

  return {
    id,
    name: text(payload.name),
    lender: text(payload.lender),
    principal,
    annualRate: finite(payload.annualRate) ?? 0,
    repayType: REPAY_TYPES.has(payload.repayType) ? payload.repayType : null,
    interestDay: dayOfMonth(payload.interestDay),
    startDate: date(payload.startDate),
    maturityDate: date(payload.maturityDate),
    closedAt: finite(payload.closedAt) > 0 ? finite(payload.closedAt) : null,
    note: text(payload.note),
    repaidPrincipal: round2(repaid),
    paidInterest: round2(interest),
    // Overpaying does not make the lender owe the user.
    remainingPrincipal: Math.max(0, round2(principal - repaid)),
    repayments
  }
}

function toPlan(payloads) {
  const plan = payloads.find(item => item.kind === 'plan' && item.id === PLAN_ID)
    || payloads.find(item => item.kind === 'plan')
  if (!plan) return null
  return {
    paydayDom: dayOfMonth(plan.paydayDom),
    monthlyPlan: money(plan.monthlyPlan)
  }
}

function summariseLoans(loans) {
  const total = key => round2(loans.reduce((sum, loan) => sum + loan[key], 0))
  return {
    count: loans.length,
    principal: total('principal'),
    repaidPrincipal: total('repaidPrincipal'),
    paidInterest: total('paidInterest'),
    remainingPrincipal: total('remainingPrincipal')
  }
}

export function shapeDebts({ debts = [], entries = [] }) {
  const payloads = debts.filter(isObject)
  const fromLedger = ledgerRepaymentsByLoan(entries)
  const loans = payloads
    .filter(item => item.kind === 'loan' && text(item.id))
    .map(item => ({ loan: toLoan(item, fromLedger), sortOrder: finite(item.sortOrder) ?? Infinity }))
    // Infinity - Infinity is NaN, which is falsy, so unordered loans fall
    // through to the maturity date like everyone else.
    .sort((a, b) => (
      (a.sortOrder - b.sortOrder)
      || compareDates(a.loan.maturityDate, b.loan.maturityDate)
      || a.loan.id.localeCompare(b.loan.id)
    ))
    .map(item => item.loan)

  return {
    plan: toPlan(payloads),
    loans,
    summary: summariseLoans(loans)
  }
}
